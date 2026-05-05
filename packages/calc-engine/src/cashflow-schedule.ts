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
 * Thrown by `generateSchedule` when input is structurally valid but
 * the engine cannot produce a TValue-parity result — e.g. a compute
 * method that hasn't been implemented yet. Routes catch this and
 * surface a 422 to the operator rather than emitting wrong cents.
 */
export class ScheduleGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleGenerationError";
  }
}

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
/**
 * Phase 7.3 — interest accrual dispatch by compute method.
 *
 *   Normal      — balance * rate * yearFraction(prev, curr, dayCount)
 *                 with the master's day-count. Compounding happens
 *                 implicitly through the balance accumulator.
 *
 *   USRule      — same simple-interest accrual as Normal, but unpaid
 *                 interest is NEVER capitalized into balance. The
 *                 payment loop carries unpaid interest in a separate
 *                 accumulator (handled in the main switch).
 *
 *   Canadian    — semi-annual compounding on monthly payments. The
 *                 nominal rate is split: r_sa = master.rate / 2, then
 *                 r_monthly_eff = (1 + r_sa)^(1/6) − 1. Per-period
 *                 accrual scales by days/30.
 *
 *   ExactDays   — overrides the master day-count to actual/365.
 *
 *   RuleOf78    — handled as a post-pass in `applyRuleOf78` rather
 *                 than inline; total interest is redistributed
 *                 across payment rows using the sum-of-digits
 *                 front-loading formula.
 */
function accrueInterest(
  balance: Decimal,
  rateNow: Decimal,
  prev: Date,
  curr: Date,
  master: MasterCalculationSettings,
): Decimal {
  if (balance.lte(0)) return ZERO;
  if (curr.getTime() <= prev.getTime()) return ZERO;
  if (master.computeMethod === "ExactDays") {
    const yf = yearFraction(prev, curr, "ACT/365");
    return balance.times(rateNow).times(yf);
  }
  if (master.computeMethod === "Canadian") {
    // Canadian mortgage convention: the quoted rate is "compounded
    // semi-annually". Effective semi-annual factor = quoted/2, then
    // monthly equivalent = (1 + quoted/2)^(1/6) − 1.
    const semi = rateNow.dividedBy(2);
    const monthlyEff = new Decimal(1).plus(semi).pow(new Decimal(1).dividedBy(6)).minus(1);
    // Scale by the number of "standard months" elapsed (driven by
    // master day-count so 30/360 sees exactly 1.0 months per
    // calendar month, ACT/365 sees days/30.4375).
    const yf = yearFraction(prev, curr, master.dayCount);
    const monthsElapsed = yf.times(12);
    return balance.times(monthlyEff).times(monthsElapsed);
  }
  // Normal + USRule + RuleOf78 (pre-redistribute): same simple accrual.
  const yf = yearFraction(prev, curr, master.dayCount);
  return balance.times(rateNow).times(yf);
}

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
  /** USRule: deficit carried forward when a payment was insufficient to cover accrued interest. */
  let unpaidInterest = ZERO;

  const rows: ScheduleRow[] = [];

  for (const event of expanded) {
    // Accrue interest between prevDate and event.date via the
    // method-aware dispatcher.
    const interestAccrued =
      prevDate !== null ? accrueInterest(balance, activeRate, prevDate, event.date, master) : ZERO;

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
        if (master.computeMethod === "USRule") {
          // US Rule: unpaid interest is NOT capitalized. Payment is
          // applied to (carry-forward + this period's accrual) first;
          // any surplus reduces principal. If the payment can't cover
          // interest, the deficit becomes the new carry-forward and
          // the balance does NOT grow.
          const interestDue = interestAccrued.plus(unpaidInterest);
          const payAbs = amount.abs();
          if (payAbs.gte(interestDue)) {
            principalApplied = payAbs.minus(interestDue);
            balance = balance.minus(principalApplied);
            unpaidInterest = ZERO;
          } else {
            principalApplied = ZERO;
            unpaidInterest = interestDue.minus(payAbs);
          }
          cumInterest = cumInterest.plus(interestAccrued);
          cumPrincipal = cumPrincipal.plus(principalApplied);
        } else {
          // Normal accrual: interest is capitalized into balance via
          // the standard waterfall. Negative-amortization permitted.
          const interestDue = interestAccrued;
          if (amount.abs().gte(interestDue)) {
            principalApplied = amount.abs().minus(interestDue);
            balance = balance.plus(interestDue).minus(amount.abs());
          } else {
            principalApplied = ZERO;
            balance = balance.plus(interestDue).minus(amount.abs());
            hasNegativeAm = true;
          }
          cumInterest = cumInterest.plus(interestDue);
          cumPrincipal = cumPrincipal.plus(principalApplied);
        }
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

  const result: ScheduleResult = {
    rows,
    endingBalance: money(balance),
    totalInterest: money(cumInterest),
    totalPrincipal: money(cumPrincipal),
    hasNegativeAm,
  };

  if (master.computeMethod === "RuleOf78") {
    return applyRuleOf78(result);
  }

  return result;
}

/**
 * Phase 7.3 — RuleOf78 redistribution.
 *
 * Sum-of-digits / "Rule of 78" front-loads finance charges in
 * fixed-payment closed-end loans. Unlike Normal accrual, period k
 * of N receives interest:
 *
 *   I_k = TOTAL_INTEREST × (N − k + 1) / (N(N+1)/2)
 *
 * The total interest is the same as Normal — only the period
 * distribution differs. Principal_k is recomputed as
 * payment_k − I_k, and the running balance is rebuilt.
 *
 * This implementation runs after a Normal pass: it preserves the
 * non-payment rows (loan, rate_change, memo, etc.) as-is, then
 * walks payment-class rows (`payment`, `balloon`, `interest_only`,
 * `fixed_principal`) in chronological order and reassigns interest
 * by their ordinal position.
 */
function applyRuleOf78(normal: ScheduleResult): ScheduleResult {
  const paymentIndices: number[] = [];
  for (let i = 0; i < normal.rows.length; i++) {
    const k = normal.rows[i]?.kind;
    if (k === "payment" || k === "balloon") paymentIndices.push(i);
  }
  const N = paymentIndices.length;
  if (N === 0) return normal;

  // Total interest stays the same as Normal — RoF78 only redistributes.
  const totalInterest = new Decimal(normal.totalInterest);
  const sumOfDigits = new Decimal(N).times(N + 1).dividedBy(2);

  const newRows: ScheduleRow[] = normal.rows.map((r) => ({ ...r }));

  // Rebuild balance by iterating chronologically and applying
  // redistributed interest to payment rows. Non-payment rows take
  // the original opening/closing because their effect on balance
  // doesn't depend on period interest.
  let runningBalance = ZERO;
  let cumInterest = ZERO;
  let cumPrincipal = ZERO;
  let paymentOrdinal = 0;
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i]!;
    const opening = runningBalance;
    let interest = new Decimal(row.interestAccrued);
    let principal = new Decimal(row.principalApplied);
    let payment = new Decimal(row.paymentApplied);

    const isRoF78Payment = row.kind === "payment" || row.kind === "balloon";
    if (isRoF78Payment) {
      paymentOrdinal++;
      const weight = new Decimal(N - paymentOrdinal + 1).dividedBy(sumOfDigits);
      interest = totalInterest.times(weight);
      payment = new Decimal(row.paymentApplied);
      principal = payment.abs().minus(interest);
      if (principal.lt(0)) principal = ZERO;
      runningBalance = opening.minus(principal);
    } else if (row.kind === "loan" || row.kind === "deposit") {
      runningBalance = opening.plus(new Decimal(row.closing).minus(opening));
    } else if (row.kind === "withdrawal") {
      runningBalance = opening.plus(new Decimal(row.closing).minus(opening));
    } else {
      runningBalance = new Decimal(row.closing);
    }

    cumInterest = cumInterest.plus(interest);
    cumPrincipal = cumPrincipal.plus(principal);

    newRows[i] = {
      ...row,
      opening: money(opening),
      interestAccrued: money(interest),
      paymentApplied: money(payment),
      principalApplied: money(principal),
      closing: money(runningBalance),
      cumulativeInterest: money(cumInterest),
      cumulativePrincipal: money(cumPrincipal),
    };
  }

  return {
    rows: newRows,
    endingBalance: money(runningBalance),
    totalInterest: money(cumInterest),
    totalPrincipal: money(cumPrincipal),
    hasNegativeAm: false,
  };
}
