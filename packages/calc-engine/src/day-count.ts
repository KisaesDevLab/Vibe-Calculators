import Decimal from "decimal.js";

/**
 * Phase 5.3 — day-count conventions.
 *
 * Each function returns the *number of days* between d1 (inclusive)
 * and d2 (exclusive, the standard finance convention) according to
 * the named rule. Year-fraction helpers in year-length.ts use these.
 *
 * Convention names match the build-plan §5.3 list:
 *   - 30/360       European 30/360 (a.k.a. 30E/360)  — symmetrical, no end-of-month exceptions
 *   - 30/360 US    US 30/360 ('Bond Basis')          — adjusts day-of-month at month-end
 *   - 30/365       30/365 hybrid                      — uses 30-day months, 365-day year
 *   - ACT/365      Actual / 365                       — actual elapsed days, 365 base
 *   - ACT/360      Actual / 360                       — actual elapsed days, 360 base ('Money Market')
 *   - ACT/ACT ISDA Actual / Actual ISDA              — splits at year boundary, uses real year length
 *
 * All five from the build plan are implemented; the US 30/360 variant
 * is a frequent ask too so it's included.
 */

export type DayCountConvention =
  | "30/360"
  | "30/360-US"
  | "30/365"
  | "ACT/365"
  | "ACT/360"
  | "ACT/ACT-ISDA";

interface YMD {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

function ymd(d: Date): YMD {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year: number): number {
  return isLeap(year) ? 366 : 365;
}

function isLastDayOfMonth(y: number, m: number, d: number): boolean {
  const month0 = m - 1;
  const next = new Date(Date.UTC(y, month0 + 1, 1));
  const lastDay = new Date(next.getTime() - 24 * 3600 * 1000).getUTCDate();
  return d === lastDay;
}

/** European 30/360 (also called 30E/360). */
export function days30_360(d1: Date, d2: Date): number {
  const a = ymd(d1);
  const b = ymd(d2);
  const d1day = a.d === 31 ? 30 : a.d;
  const d2day = b.d === 31 ? 30 : b.d;
  return 360 * (b.y - a.y) + 30 * (b.m - a.m) + (d2day - d1day);
}

/**
 * US 30/360 ('Bond Basis'). Same as 30/360 but with end-of-month
 * exceptions: if d1 is Feb's last day and d2 is Feb's last day,
 * d2 is treated as 30; if d1 is the last of any month, d2's day
 * adjusts to 30 only when d1 is also.
 */
export function days30_360US(d1: Date, d2: Date): number {
  const a = ymd(d1);
  const b = ymd(d2);
  let dd1 = a.d;
  let dd2 = b.d;
  const aIsEom = isLastDayOfMonth(a.y, a.m, a.d);
  const bIsEom = isLastDayOfMonth(b.y, b.m, b.d);
  // Rule (a): If both are last day of February, dd2 is set to 30.
  if (a.m === 2 && aIsEom && b.m === 2 && bIsEom) dd2 = 30;
  // Rule (b): If d1 is last day of February, dd1 is set to 30.
  if (a.m === 2 && aIsEom) dd1 = 30;
  // Rule (c): If dd2 is 31 and dd1 is 30 or 31, dd2 is 30.
  if (dd2 === 31 && (dd1 === 30 || dd1 === 31)) dd2 = 30;
  // Rule (d): If dd1 is 31, set to 30.
  if (dd1 === 31) dd1 = 30;
  return 360 * (b.y - a.y) + 30 * (b.m - a.m) + (dd2 - dd1);
}

/** Actual elapsed calendar days. */
export function daysActual(d1: Date, d2: Date): number {
  const ms = d2.getTime() - d1.getTime();
  return Math.round(ms / (24 * 3600 * 1000));
}

export const daysActual360 = daysActual;
export const daysActual365 = daysActual;
export const days30_365 = days30_360; // share numerator; year-length differs

// ---------------------------------------------------------------------
// Year fractions — each convention's "elapsed years between d1 and d2"
// ---------------------------------------------------------------------

export function yearFraction(d1: Date, d2: Date, convention: DayCountConvention): Decimal {
  switch (convention) {
    case "30/360":
      return new Decimal(days30_360(d1, d2)).div(360);
    case "30/360-US":
      return new Decimal(days30_360US(d1, d2)).div(360);
    case "30/365":
      return new Decimal(days30_360(d1, d2)).div(365);
    case "ACT/360":
      return new Decimal(daysActual360(d1, d2)).div(360);
    case "ACT/365":
      return new Decimal(daysActual365(d1, d2)).div(365);
    case "ACT/ACT-ISDA":
      return yearFractionActActISDA(d1, d2);
  }
}

/**
 * ACT/ACT ISDA: split the period at year boundaries and divide the
 * actual days in each year by that year's actual length (365 or 366).
 */
function yearFractionActActISDA(d1: Date, d2: Date): Decimal {
  if (d1.getTime() === d2.getTime()) return new Decimal(0);
  const reverse = d1 > d2;
  const start = reverse ? d2 : d1;
  const end = reverse ? d1 : d2;
  let total = new Decimal(0);
  let cursor = new Date(start.getTime());
  while (true) {
    const year = cursor.getUTCFullYear();
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const segmentEnd = end < yearEnd ? end : yearEnd;
    const segDays = daysActual(cursor, segmentEnd);
    total = total.plus(new Decimal(segDays).div(daysInYear(year)));
    if (segmentEnd.getTime() >= end.getTime()) break;
    cursor = yearEnd;
  }
  return reverse ? total.negated() : total;
}
