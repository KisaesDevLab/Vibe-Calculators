import { money, type Money } from "./types.js";
import type { ScheduleResult } from "./cashflow-schedule.js";
import Decimal from "decimal.js";

/**
 * Phase 13.2 — schedule subtotals.
 *
 * Walks a `ScheduleResult` and emits subtotal rows for each fiscal
 * period (annual, quarterly, monthly) plus an optional grand total.
 * Fiscal year-end month is configurable (TValue parity feature) so a
 * firm with a non-calendar fiscal year groups correctly.
 *
 * The result is a list of subtotal markers — each one says "after
 * row index N, insert a subtotal labelled `label` with these
 * payment / interest / principal sums." PDF rendering inserts these
 * inline as bold rows.
 *
 * Sign convention: payment / principal sums use the engine's already-
 * computed positive `principalApplied` and `paymentApplied`. Interest
 * is the per-row `interestAccrued`.
 */

export type SubtotalCadence = "annual" | "quarterly" | "monthly";

export interface ScheduleSubtotal {
  /** Display label, e.g. "2024 Totals", "Q3 2024", "Dec 2024", "Grand Total". */
  label: string;
  /** Insert this subtotal AFTER `rows[afterRowIndex]`. -1 = at the very end. */
  afterRowIndex: number;
  totalPayment: Money;
  totalInterest: Money;
  totalPrincipal: Money;
}

export interface SubtotalOptions {
  /**
   * 1..12 — month in which the fiscal year ends. December (12) =
   * calendar year. June (6) = "FY 2024" runs Jul 2023 → Jun 2024.
   */
  fiscalYearEndMonth?: number;
  /** Group cadence. Default 'annual'. */
  cadence?: SubtotalCadence;
  /** Append a final "Grand Total" row. Default false. */
  grandTotal?: boolean;
}

/**
 * Compute the fiscal year a date belongs to given the year-end
 * month. With yearEndMonth=12 (default), this is the calendar year.
 * With yearEndMonth=6: dates in Jan–Jun belong to FY=year, dates in
 * Jul–Dec belong to FY=year+1.
 */
export function fiscalYearOf(date: Date, yearEndMonth: number): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return m <= yearEndMonth ? y : y + 1;
}

/** Quarter (1..4) of a date relative to a fiscal-year start. */
export function fiscalQuarterOf(
  date: Date,
  yearEndMonth: number,
): { fiscalYear: number; quarter: number } {
  const fy = fiscalYearOf(date, yearEndMonth);
  // Fiscal year ends in `yearEndMonth`; starts the month after.
  // Compute month index relative to start (0..11).
  const m = date.getUTCMonth() + 1; // 1..12
  const fyStart = (yearEndMonth % 12) + 1; // month after the year-end
  let monthsFromStart: number;
  if (m >= fyStart) {
    monthsFromStart = m - fyStart;
  } else {
    monthsFromStart = m + 12 - fyStart;
  }
  const quarter = Math.floor(monthsFromStart / 3) + 1;
  return { fiscalYear: fy, quarter };
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function computeSubtotals(
  schedule: ScheduleResult,
  options: SubtotalOptions = {},
): ScheduleSubtotal[] {
  const fiscalYearEndMonth = clampMonth(options.fiscalYearEndMonth ?? 12);
  const cadence: SubtotalCadence = options.cadence ?? "annual";
  const out: ScheduleSubtotal[] = [];

  if (schedule.rows.length === 0) {
    if (options.grandTotal) {
      out.push({
        label: "Grand Total",
        afterRowIndex: -1,
        totalPayment: money("0"),
        totalInterest: money("0"),
        totalPrincipal: money("0"),
      });
    }
    return out;
  }

  // Walk rows, switching groups when the cadence-key changes.
  let runPayment = new Decimal(0);
  let runInterest = new Decimal(0);
  let runPrincipal = new Decimal(0);
  let prevKey: string | null = null;
  let prevLabel = "";
  let prevGroupStart = 0;

  function emitGroup(afterIdx: number): void {
    out.push({
      label: prevLabel,
      afterRowIndex: afterIdx,
      totalPayment: money(runPayment),
      totalInterest: money(runInterest),
      totalPrincipal: money(runPrincipal),
    });
    runPayment = new Decimal(0);
    runInterest = new Decimal(0);
    runPrincipal = new Decimal(0);
  }

  for (let i = 0; i < schedule.rows.length; i++) {
    const row = schedule.rows[i]!;
    const { key, label } = groupKeyAndLabel(row.date, cadence, fiscalYearEndMonth);
    if (prevKey === null) {
      prevKey = key;
      prevLabel = label;
      prevGroupStart = i;
    } else if (key !== prevKey) {
      // Close out the previous group.
      emitGroup(i - 1);
      prevKey = key;
      prevLabel = label;
      prevGroupStart = i;
    }
    runPayment = runPayment.plus(new Decimal(row.paymentApplied));
    runInterest = runInterest.plus(new Decimal(row.interestAccrued));
    runPrincipal = runPrincipal.plus(new Decimal(row.principalApplied));
  }
  // Final group.
  if (prevKey !== null) {
    emitGroup(schedule.rows.length - 1);
  }
  // Suppress prevGroupStart unused-warning — it's a deliberate marker
  // for future "drill into group" UX.
  void prevGroupStart;

  if (options.grandTotal) {
    out.push({
      label: "Grand Total",
      afterRowIndex: schedule.rows.length - 1,
      totalPayment: money(new Decimal(schedule.totalInterest).plus(schedule.totalPrincipal)),
      totalInterest: money(schedule.totalInterest),
      totalPrincipal: money(schedule.totalPrincipal),
    });
  }

  return out;
}

function groupKeyAndLabel(
  date: Date,
  cadence: SubtotalCadence,
  yearEndMonth: number,
): { key: string; label: string } {
  if (cadence === "annual") {
    const fy = fiscalYearOf(date, yearEndMonth);
    return { key: `Y${fy}`, label: `${fy} Totals` };
  }
  if (cadence === "quarterly") {
    const { fiscalYear, quarter } = fiscalQuarterOf(date, yearEndMonth);
    return { key: `Y${fiscalYear}Q${quarter}`, label: `Q${quarter} ${fiscalYear}` };
  }
  // monthly
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return { key: `${y}-${m}`, label: `${MONTH_NAMES[m]} ${y}` };
}

function clampMonth(m: number): number {
  if (!Number.isFinite(m)) return 12;
  const i = Math.floor(m);
  if (i < 1) return 1;
  if (i > 12) return 12;
  return i;
}
