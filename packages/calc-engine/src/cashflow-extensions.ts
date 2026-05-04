import Decimal from "decimal.js";
import { money, type Money } from "./types.js";
import type { CashFlowEvent } from "./cashflow-events.js";
import type { ScheduleResult, ScheduleRow } from "./cashflow-schedule.js";
import { addPeriods } from "./date-arithmetic.js";

/**
 * Phase 7 extensions — additional series-pattern expanders, alternate
 * compute methods, and level-of-detail rollups.
 *
 * Pattern rationale: keeping these in a separate file makes the core
 * schedule generator small and testable, while the workbench picks
 * up the extensions via the same expandSeries / generateSchedule
 * surface.
 */

const ZERO = new Decimal(0);

// ---------------------------------------------------------------------
// Series-pattern expanders (Phase 7.11 extensions)
// ---------------------------------------------------------------------

/**
 * Expand a stepped_percentage event: each step multiplies the
 * preceding amount by (1 + stepPercent). e.g. step=3% every 12 periods
 * for 36 months yields (base, base*1.03, base*1.0609).
 */
export function expandSteppedPercentage(
  e: CashFlowEvent,
  monthlyDefault = "monthly" as const,
): CashFlowEvent[] {
  if (e.kind !== "stepped_percentage") return [e];
  const base = (e.amount ?? money("0")).toNumber();
  const stepPct = e.seriesOptions?.stepPercent
    ? (e.seriesOptions.stepPercent as Decimal).toNumber()
    : 0;
  const stepEvery = e.seriesOptions?.stepEvery ?? 1;
  const interval = e.interval ?? monthlyDefault;
  const count = e.count ?? 1;
  const out: CashFlowEvent[] = [];
  let cursor = e.date;
  for (let k = 0; k < count; k++) {
    const stepNumber = Math.floor(k / stepEvery);
    const factor = Math.pow(1 + stepPct, stepNumber);
    const amt = base * factor;
    const sub: CashFlowEvent = {
      date: cursor,
      kind: "payment",
      amount: money(amt.toFixed(6)),
    };
    if (e.memo !== undefined) sub.memo = e.memo;
    else sub.memo = `Stepped-pct payment #${k + 1}`;
    out.push(sub);
    cursor = addPeriods(cursor, 1, interval);
  }
  return out;
}

/**
 * Expand a skip_pattern event: N consecutive payments followed by M
 * skips, repeating until `count` payments have been emitted (skip
 * cycles don't count toward `count`).
 */
export function expandSkipPattern(e: CashFlowEvent): CashFlowEvent[] {
  if (e.kind !== "skip_pattern") return [e];
  const opts = e.seriesOptions?.skipNPayMSkip;
  if (!opts) return [];
  const interval = e.interval ?? "monthly";
  const count = e.count ?? 1;
  const out: CashFlowEvent[] = [];
  let cursor = e.date;
  let payCount = 0;
  while (payCount < count) {
    for (let k = 0; k < opts.pay && payCount < count; k++) {
      const sub: CashFlowEvent = {
        date: cursor,
        kind: "payment",
        amount: e.amount ?? money("0"),
      };
      if (e.memo !== undefined) sub.memo = e.memo;
      out.push(sub);
      cursor = addPeriods(cursor, 1, interval);
      payCount++;
    }
    // Skip M periods.
    for (let k = 0; k < opts.skip; k++) {
      cursor = addPeriods(cursor, 1, interval);
    }
  }
  return out;
}

/**
 * Expand a calendar_month_skip event: pay only in months not in
 * skipMonths. Walks `count` total potential periods; emits a payment
 * for each retained month, skips the rest.
 */
export function expandCalendarMonthSkip(e: CashFlowEvent): CashFlowEvent[] {
  if (e.kind !== "calendar_month_skip") return [e];
  const skip = new Set(e.seriesOptions?.skipMonths ?? []);
  const interval = e.interval ?? "monthly";
  const count = e.count ?? 1;
  const out: CashFlowEvent[] = [];
  let cursor = e.date;
  for (let k = 0; k < count; k++) {
    const month1 = cursor.getUTCMonth() + 1;
    if (!skip.has(month1)) {
      const sub: CashFlowEvent = {
        date: cursor,
        kind: "payment",
        amount: e.amount ?? money("0"),
      };
      if (e.memo !== undefined) sub.memo = e.memo;
      out.push(sub);
    }
    cursor = addPeriods(cursor, 1, interval);
  }
  return out;
}

/**
 * Expand a fixed_principal event into N payments where each is
 * (fixedPrincipal + accruedInterest). Because the interest depends
 * on the running balance which the schedule generator tracks, this
 * function emits *sentinel* events that the generator interprets at
 * row-time. We piggyback on the 'fixed_principal' kind passing it
 * through as an atomic event with amount = the fixed principal
 * portion; the generator at row-time computes
 *   payment.amount = fixedPrincipal + interestAccrued
 * and applies it.
 */
export function expandFixedPrincipal(e: CashFlowEvent): CashFlowEvent[] {
  if (e.kind !== "fixed_principal") return [e];
  const interval = e.interval ?? "monthly";
  const count = e.count ?? 1;
  const out: CashFlowEvent[] = [];
  let cursor = e.date;
  for (let k = 0; k < count; k++) {
    const sub: CashFlowEvent = {
      date: cursor,
      kind: "fixed_principal",
      amount: e.amount ?? money("0"),
    };
    if (e.memo !== undefined) sub.memo = e.memo;
    else sub.memo = `Fixed-principal payment #${k + 1}`;
    out.push(sub);
    cursor = addPeriods(cursor, 1, interval);
  }
  return out;
}

// ---------------------------------------------------------------------
// Alternate compute methods — Phase 7.3 extensions
// ---------------------------------------------------------------------

/**
 * Rule-of-78 finance-charge front-loading.
 *
 * For a loan with N total payments, the interest portion of payment
 * k is:
 *   interest_k = totalFinanceCharge * (N - k + 1) / sum(1..N)
 *
 * Returns the per-payment interest schedule. Caller multiplies the
 * principal schedule from a level-payment amortization to produce
 * the full waterfall.
 */
export function ruleOf78Schedule(
  totalFinanceCharge: Money,
  totalPayments: number,
): readonly { paymentNumber: number; interestPortion: Money }[] {
  const N = totalPayments;
  const sumDigits = (N * (N + 1)) / 2;
  const out: { paymentNumber: number; interestPortion: Money }[] = [];
  for (let k = 1; k <= N; k++) {
    const portion = totalFinanceCharge.times(N - k + 1).div(sumDigits);
    out.push({ paymentNumber: k, interestPortion: money(portion) });
  }
  return out;
}

/**
 * US Rule simple interest: interest accrues but does NOT compound.
 * Unpaid interest accumulates in a separate bucket and never earns
 * interest itself. This helper computes the simple interest for a
 * given balance / rate / day-fraction.
 */
export function simpleInterest(
  balance: Money,
  rateValue: Decimal,
  yearFractionValue: Decimal,
): Money {
  return money(balance.times(rateValue).times(yearFractionValue));
}

// ---------------------------------------------------------------------
// Level-of-detail rollup (Phase 7.8)
// ---------------------------------------------------------------------

export interface ScheduleRollupRow {
  /** Year label, e.g. 2025 (or fiscal-year identifier). */
  year: number;
  rowsAggregated: number;
  totalInterest: Money;
  totalPrincipal: Money;
  endingBalance: Money;
}

/**
 * Annual rollup: groups schedule rows by calendar year (UTC) and
 * sums interest + principal. Closing balance for each year is the
 * closing balance of the last row in that year.
 */
export function rollupByYear(result: ScheduleResult): ScheduleRollupRow[] {
  const buckets = new Map<number, ScheduleRow[]>();
  for (const row of result.rows) {
    const y = row.date.getUTCFullYear();
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y)!.push(row);
  }
  const out: ScheduleRollupRow[] = [];
  for (const [year, rows] of [...buckets.entries()].sort(([a], [b]) => a - b)) {
    let interest = ZERO;
    let principal = ZERO;
    for (const row of rows) {
      interest = interest.plus(row.interestAccrued);
      principal = principal.plus(row.principalApplied);
    }
    out.push({
      year,
      rowsAggregated: rows.length,
      totalInterest: money(interest),
      totalPrincipal: money(principal),
      endingBalance: rows[rows.length - 1]!.closing,
    });
  }
  return out;
}

/**
 * Fiscal-year rollup: groups schedule rows by fiscal-year-end month.
 * fiscalYearEndMonth is 1..12 (e.g. 6 for June year-end). A row in
 * July 2025 with a June year-end belongs to FY2026 (the year
 * *ending* in June 2026).
 */
export function rollupByFiscalYear(
  result: ScheduleResult,
  fiscalYearEndMonth: number,
): ScheduleRollupRow[] {
  const fyem = Math.max(1, Math.min(12, Math.floor(fiscalYearEndMonth)));
  const buckets = new Map<number, ScheduleRow[]>();
  for (const row of result.rows) {
    const y = row.date.getUTCFullYear();
    const m = row.date.getUTCMonth() + 1; // 1..12
    const fy = m > fyem ? y + 1 : y;
    if (!buckets.has(fy)) buckets.set(fy, []);
    buckets.get(fy)!.push(row);
  }
  const out: ScheduleRollupRow[] = [];
  for (const [fy, rows] of [...buckets.entries()].sort(([a], [b]) => a - b)) {
    let interest = ZERO;
    let principal = ZERO;
    for (const row of rows) {
      interest = interest.plus(row.interestAccrued);
      principal = principal.plus(row.principalApplied);
    }
    out.push({
      year: fy,
      rowsAggregated: rows.length,
      totalInterest: money(interest),
      totalPrincipal: money(principal),
      endingBalance: rows[rows.length - 1]!.closing,
    });
  }
  return out;
}

/**
 * Range filter: returns only rows whose date falls inside [from, to]
 * inclusive. Bookended by from < to convention.
 */
export function rollupByRange(result: ScheduleResult, from: Date, to: Date): ScheduleRow[] {
  return result.rows.filter((r) => r.date >= from && r.date <= to);
}
