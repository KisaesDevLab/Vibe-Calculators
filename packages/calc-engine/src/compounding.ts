import Decimal from "decimal.js";

/**
 * Phase 5.5 — compounding intervals + period-length resolver.
 *
 * Build plan list:
 *   daily, weekly, biweekly, half-month, four-week, monthly,
 *   bi-monthly, quarterly, semi-annual, annual, continuous, exact-days
 *
 * 'continuous' has no discrete period count per year; consumers that
 * need a numeric value should branch on the continuous tag rather
 * than reading periodsPerYear.
 *
 * 'exact-days' is the catch-all for irregular series — the period
 * length is supplied explicitly by the cash-flow event row in
 * Phase 7.
 */

export type CompoundingInterval =
  | "daily"
  | "weekly"
  | "biweekly"
  | "half-month"
  | "four-week"
  | "monthly"
  | "bi-monthly"
  | "quarterly"
  | "semi-annual"
  | "annual"
  | "continuous"
  | "exact-days";

/**
 * Periods per year for a given interval, assuming a 365-day base
 * year. Returns null for 'continuous' (no discrete count) and
 * 'exact-days' (caller supplies its own period count).
 */
export function periodsPerYear(interval: CompoundingInterval): number | null {
  switch (interval) {
    case "daily":
      return 365;
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "half-month":
      return 24;
    case "four-week":
      return 13;
    case "monthly":
      return 12;
    case "bi-monthly":
      return 6;
    case "quarterly":
      return 4;
    case "semi-annual":
      return 2;
    case "annual":
      return 1;
    case "continuous":
    case "exact-days":
      return null;
  }
}

/**
 * Length of a single period in days using a 365-day base year.
 * Half-month uses 365/24; biweekly is exactly 14; weekly is exactly 7.
 */
export function periodLengthDays(interval: CompoundingInterval): Decimal | null {
  switch (interval) {
    case "weekly":
      return new Decimal(7);
    case "biweekly":
      return new Decimal(14);
    case "four-week":
      return new Decimal(28);
    case "daily":
      return new Decimal(1);
    case "half-month":
    case "monthly":
    case "bi-monthly":
    case "quarterly":
    case "semi-annual":
    case "annual": {
      const p = periodsPerYear(interval);
      return p === null ? null : new Decimal(365).div(p);
    }
    case "continuous":
    case "exact-days":
      return null;
  }
}

/**
 * Two intervals are 'compatible' (one tiles the other) iff one's
 * periods-per-year is a multiple of the other. Used by the workbench
 * (Phase 11.18) to disable Period dropdown entries that would not
 * tile cleanly into the master compounding period.
 */
export function isCompatibleSubInterval(
  master: CompoundingInterval,
  sub: CompoundingInterval,
): boolean {
  const m = periodsPerYear(master);
  const s = periodsPerYear(sub);
  if (m === null || s === null) {
    // continuous / exact-days are always compatible (the engine
    // resolves them per-event in Phase 7).
    return true;
  }
  return s % m === 0;
}
