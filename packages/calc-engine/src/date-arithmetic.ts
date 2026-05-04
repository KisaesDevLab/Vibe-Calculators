import type { CompoundingInterval } from "./compounding.js";

/**
 * Phase 5.7 — date arithmetic helpers.
 *
 * All functions operate on UTC. CLAUDE.md mandates "All timestamps
 * stored UTC, displayed in firm timezone (firm-level setting)" — so
 * the calc-engine never reads local-time getters.
 *
 * `addPeriods` handles every compounding interval EXCEPT 'continuous'
 * (no discrete period) and 'exact-days' (caller passes the explicit
 * days). For half-month, the convention is the 15th and the last day
 * of the month.
 */

const MS_PER_DAY = 24 * 3600 * 1000;

function lastDayOfMonth(y: number, m0: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function addUtcWeeks(date: Date, weeks: number): Date {
  return addUtcDays(date, weeks * 7);
}

/**
 * Add months in UTC. When the source day-of-month doesn't exist in
 * the target (e.g. Jan 31 + 1 month), clamp to the last day.
 */
export function addUtcMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m0 = date.getUTCMonth() + months;
  const targetY = y + Math.floor(m0 / 12);
  const targetM0 = ((m0 % 12) + 12) % 12;
  const sourceDay = date.getUTCDate();
  const lastDay = lastDayOfMonth(targetY, targetM0);
  const day = Math.min(sourceDay, lastDay);
  return new Date(
    Date.UTC(
      targetY,
      targetM0,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function addUtcYears(date: Date, years: number): Date {
  return addUtcMonths(date, years * 12);
}

export function endOfUtcMonth(date: Date): Date {
  const y = date.getUTCFullYear();
  const m0 = date.getUTCMonth();
  return new Date(Date.UTC(y, m0, lastDayOfMonth(y, m0)));
}

export function setUtcDate(date: Date, day: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function isWeekendUtc(date: Date): boolean {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

// ---------------------------------------------------------------------
// Period arithmetic
// ---------------------------------------------------------------------

export function addPeriods(date: Date, count: number, interval: CompoundingInterval): Date {
  if (count === 0) return date;
  switch (interval) {
    case "daily":
      return addUtcDays(date, count);
    case "weekly":
      return addUtcWeeks(date, count);
    case "biweekly":
      return addUtcWeeks(date, count * 2);
    case "four-week":
      return addUtcWeeks(date, count * 4);
    case "monthly":
      return addUtcMonths(date, count);
    case "bi-monthly":
      return addUtcMonths(date, count * 2);
    case "quarterly":
      return addUtcMonths(date, count * 3);
    case "semi-annual":
      return addUtcMonths(date, count * 6);
    case "annual":
      return addUtcYears(date, count);
    case "half-month":
      return addHalfMonths(date, count);
    case "continuous":
    case "exact-days":
      throw new Error(
        `addPeriods cannot resolve '${interval}'; supply explicit days via addUtcDays`,
      );
  }
}

export function addHalfMonths(date: Date, count: number): Date {
  let cursor = snapToHalfMonth(date);
  const dir: 1 | -1 = count > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(count); i++) {
    cursor = step(cursor, dir);
  }
  return cursor;

  function step(d: Date, direction: 1 | -1): Date {
    const day = d.getUTCDate();
    if (direction === 1) {
      if (day === 15) return endOfUtcMonth(d);
      // Last day of month → 15th of next month.
      return setUtcDate(addUtcMonths(d, 1), 15);
    }
    if (day === 15) return endOfUtcMonth(addUtcMonths(d, -1));
    return setUtcDate(d, 15);
  }
}

export function snapToHalfMonth(date: Date): Date {
  const day = date.getUTCDate();
  if (day === 15) return date;
  if (day < 15) return setUtcDate(date, 15);
  return endOfUtcMonth(date);
}

/**
 * Move forward to the next non-weekend UTC day. Holidays are not
 * considered.
 */
export function nextBusinessDay(date: Date): Date {
  let d = date;
  while (isWeekendUtc(d)) d = addUtcDays(d, 1);
  return d;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
