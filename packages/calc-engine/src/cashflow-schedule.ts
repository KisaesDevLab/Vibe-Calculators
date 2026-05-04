import Decimal from "decimal.js";
import { money, rate, type Money, type Rate } from "./types.js";
import { yearFraction } from "./day-count.js";
import { addPeriods as addCompoundPeriods } from "./date-arithmetic.js";
import { type CashFlowEvent, type MasterCalculationSettings } from "./cashflow-events.js";
import {
  expandCalendarMonthSkip,
  expandFixedPrincipal,
  expandSkipPattern,
  expandSteppedPercentage,
} from "./cashflow-extensions.js";

/**
 * Phase 7.4 — schedule generator (Normal compute method).
 *
 * Walks the sorted event list. For each transition between adjacent
 * events at distinct dates, accrues interest from the previous-event
 * date to the current-event date under the active rate using the
 * master's day-count convention. Then applies the event:
 *
 *   loan / deposit:      balance += amount
 *   payment:             interest paid first, remainder reduces principal
 *   withdrawal:          balance -= amount (interest is also accrued)
 *   balloon:             one-shot payment, same waterfall as payment
 *   prepayment:          principal-only (interest-skip)
 *   rate_change:         active rate flips from this date forward
 *   stepped_amount:      *expanded* before this function — see expandSeries()
 *   stepped_percentage:  same
 *   interest_only:       payment.amount = currentInterest at row-time
 *   skip_pattern / calendar_month_skip:  expanded into payment/skip rows
 *   memo:                no balance effect
 *
 * The schedule ROW emitted for each event:
 *   { date, opening, interestAccrued, paymentApplied, principalApplied,
 *     closing, cumulativeInterest, cumulativePrincipal, kind, memo,
 *     negativeAm }
 */

export interface ScheduleRow {
  date: Date;
  kind: CashFlowEvent["kind"];
  opening: Money;
  interestAccrued: Money;
  paymentApplied: Money;
  principalApplied: Money;
  closing: Money;
  cumulativeInterest: Money;
  cumulativePrincipal: Money;
  rate: Rate;
  memo?: string | undefined;
  /** True if this row's interest accrual exceeded the payment, growing balance. */
  negativeAm: boolean;
}

export interface ScheduleResult {
  rows: ScheduleRow[];
  /** Closing balance after the last row. */
  endingBalance: Money;
  totalInterest: Money;
  totalPrincipal: Money;
  /** True if any row triggered negative amortization. */
  hasNegativeAm: boolean;
}

const ZERO = new Decimal(0);

/**
 * Expand series events into atomic per-period events. Core supports:
 *   - stepped_amount       — payment count * (base + step * floor((k-stepEvery)/stepEvery))
 *   - interest_only        — sentinel row that the schedule generator
 *                            interprets at row-time; we emit `count` rows
 *                            spaced by `interval`, each marked interest_only.
 *
 * The other series patterns (stepped_percentage, skip_pattern,
 * calendar_month_skip, fixed_principal, principal_applied_first,
 * existing_note_valuation) land in Phase 7 extensions.
 */
export function expandSeries(events: CashFlowEvent[]): CashFlowEvent[] {
  const out: CashFlowEvent[] = [];
  for (const e of events) {
    if (e.kind === "stepped_amount") {
      const base = (e.amount ?? money("0")).toNumber();
      const step = (e.seriesOptions?.stepAmount ?? money("0")).toNumber();
      const stepEvery = e.seriesOptions?.stepEvery ?? 1;
      const interval = e.interval ?? "monthly";
      const count = e.count ?? 1;
      let cursor = e.date;
      for (let k = 0; k < count; k++) {
        const stepNumber = Math.floor(k / stepEvery);
        const amt = base + step * stepNumber;
        out.push({
          date: cursor,
          kind: "payment",
          amount: money(amt.toFixed(6)),
          memo: e.memo ?? `Stepped payment #${k + 1}`,
        });
        cursor = addCompoundPeriods(cursor, 1, interval);
      }
      continue;
    }
    if (e.kind === "interest_only") {
      const interval = e.interval ?? "monthly";
      const count = e.count ?? 1;
      let cursor = e.date;
      for (let k = 0; k < count; k++) {
        out.push({
          date: cursor,
          kind: "interest_only",
          memo: e.memo ?? `Interest-only payment #${k + 1}`,
        });
        cursor = addCompoundPeriods(cursor, 1, interval);
      }
      continue;
    }
    if (e.kind === "stepped_percentage") {
      out.push(...expandSteppedPercentage(e));
      continue;
    }
    if (e.kind === "skip_pattern") {
      out.push(...expandSkipPattern(e));
      continue;
    }
    if (e.kind === "calendar_month_skip") {
      out.push(...expandCalendarMonthSkip(e));
      continue;
    }
    if (e.kind === "fixed_principal") {
      out.push(...expandFixedPrincipal(e));
      continue;
    }
    if (e.kind === "payment" || e.kind === "deposit" || e.kind === "withdrawal") {
      // Non-series 'payment' may still carry count + interval = recurring atomic.
      const interval = e.interval ?? "monthly";
      const count = e.count ?? 1;
      if (count <= 1 || e.amount === undefined) {
        out.push(e);
        continue;
      }
      let cursor = e.date;
      for (let k = 0; k < count; k++) {
        const sub: CashFlowEvent = { date: cursor, kind: e.kind, amount: e.amount };
        if (e.memo !== undefined) sub.memo = e.memo;
        out.push(sub);
        cursor = addCompoundPeriods(cursor, 1, interval);
      }
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * Build the amortization schedule under Normal compute method.
 *
 * Interest is accrued between events using the master rate +
 * day-count + compounding interval. We compute:
 *
 *   periodInterest = balance * rate * yearFraction(prev, curr, dayCount)
 *
 * That's an effective-rate-style accrual — equivalent to compound
 * interest when the events are spaced exactly one compounding
 * period apart, and gracefully handles off-period funding (Phase
 * 7.7's prepaid-interest case). Note: Normal compute method here
 * uses the simpler formula r * dt for ergonomics; Phase 7
 * extensions add the explicit Newton-style compound accrual that
 * matches mortgage-industry quoting more precisely.
 */
export function generateSchedule(
  events: CashFlowEvent[],
  master: MasterCalculationSettings,
): ScheduleResult {
  // Sort by date; preserve relative order within the same date.
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  const expanded = expandSeries(sorted);

  let balance = ZERO;
  let cumInterest = ZERO;
  let cumPrincipal = ZERO;
  let activeRate: Decimal = master.rate;
  let prevDate: Date | null = null;
  let hasNegativeAm = false;

  const rows: ScheduleRow[] = [];

  for (const event of expanded) {
    // Accrue interest between prevDate and event.date.
    let interestAccrued = ZERO;
    if (prevDate !== null && event.date.getTime() > prevDate.getTime() && balance.gt(0)) {
      const yf = yearFraction(prevDate, event.date, master.dayCount);
      interestAccrued = balance.times(activeRate).times(yf);
    }

    const opening = balance;
    let paymentApplied = ZERO;
    let principalApplied = ZERO;

    switch (event.kind) {
      case "loan":
      case "deposit": {
        // Interest accrued is folded into balance before adding new principal.
        balance = balance.plus(interestAccrued).plus(event.amount ?? ZERO);
        cumInterest = cumInterest.plus(interestAccrued);
        break;
      }
      case "payment":
      case "balloon": {
        const amount = event.amount ?? ZERO;
        paymentApplied = amount;
        // Interest paid first; remainder is principal.
        const interestDue = interestAccrued;
        if (amount.abs().gte(interestDue)) {
          principalApplied = amount.abs().minus(interestDue);
          balance = balance.plus(interestDue).minus(amount.abs());
        } else {
          // Negative amortization: payment doesn't cover accrued interest.
          principalApplied = ZERO;
          balance = balance.plus(interestDue).minus(amount.abs());
          hasNegativeAm = true;
        }
        cumInterest = cumInterest.plus(interestDue);
        cumPrincipal = cumPrincipal.plus(principalApplied);
        break;
      }
      case "withdrawal": {
        balance = balance.plus(interestAccrued).plus(event.amount ?? ZERO);
        cumInterest = cumInterest.plus(interestAccrued);
        break;
      }
      case "prepayment": {
        const amount = event.amount ?? ZERO;
        principalApplied = amount.abs();
        balance = balance.plus(interestAccrued).minus(amount.abs());
        cumInterest = cumInterest.plus(interestAccrued);
        cumPrincipal = cumPrincipal.plus(principalApplied);
        break;
      }
      case "rate_change": {
        balance = balance.plus(interestAccrued);
        cumInterest = cumInterest.plus(interestAccrued);
        if (event.rate) activeRate = event.rate;
        break;
      }
      case "interest_only": {
        // Pay exactly the accrued interest; balance is unchanged
        // because the payment exactly cancels the accrual.
        paymentApplied = interestAccrued;
        principalApplied = ZERO;
        cumInterest = cumInterest.plus(interestAccrued);
        break;
      }
      case "fixed_principal": {
        // Each row pays fixedPrincipal + interestAccrued. Interest
        // is accrued and immediately paid (cash outflow), so it
        // doesn't roll into the running balance — only the fixed
        // principal portion reduces it.
        const fixedP = (event.amount ?? ZERO).abs();
        paymentApplied = fixedP.plus(interestAccrued);
        principalApplied = fixedP;
        balance = balance.minus(fixedP);
        cumInterest = cumInterest.plus(interestAccrued);
        cumPrincipal = cumPrincipal.plus(principalApplied);
        break;
      }
      case "memo":
        // Memo doesn't accrue or apply anything; preserve the previous row balance.
        // No interest accrual is folded in (memo is timestamped but a no-op).
        break;
      default:
        // Series events should have been expanded above. Unhandled
        // kinds in core are passed through with the interest accrual
        // folded in but no other effect.
        balance = balance.plus(interestAccrued);
        cumInterest = cumInterest.plus(interestAccrued);
        break;
    }

    rows.push({
      date: event.date,
      kind: event.kind,
      opening: money(opening),
      interestAccrued: money(interestAccrued),
      paymentApplied: money(paymentApplied),
      principalApplied: money(principalApplied),
      closing: money(balance),
      cumulativeInterest: money(cumInterest),
      cumulativePrincipal: money(cumPrincipal),
      rate: rate(activeRate),
      memo: event.memo,
      negativeAm: balance.gt(opening) && event.kind === "payment",
    });

    prevDate = event.date;
  }

  return {
    rows,
    endingBalance: money(balance),
    totalInterest: money(cumInterest),
    totalPrincipal: money(cumPrincipal),
    hasNegativeAm,
  };
}
