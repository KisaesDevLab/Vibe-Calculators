import Decimal from "decimal.js";

/**
 * MACRS GDS (General Depreciation System) percentage tables —
 * IRS Pub 946 Appendix A, Treasury Reg §1.168(b).
 *
 * Percentages are invariant across tax years (they're locked into
 * the regulations), so they live in code rather than the
 * tax_year_tables seed.
 *
 * Each entry sums to 100.00% (or 100.000% / 100.0000% depending on
 * the published precision).
 *
 * All percentages stored as numbers in **percent** (not decimal),
 * matching the published tables. Conversion to decimal happens at
 * the call site.
 */

/** GDS half-year convention — Table A-1. */
export const GDS_HALF_YEAR: Record<string, readonly number[]> = {
  "3": [33.33, 44.45, 14.81, 7.41],
  "5": [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  "7": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  "10": [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  "15": [5.0, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
  "20": [
    3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461,
    4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231,
  ],
};

/**
 * GDS mid-month convention for residential rental (27.5-year) and
 * nonresidential real (39-year). Tables A-6 and A-7a.
 *
 * Year-1 percentage depends on the placed-in-service month
 * (1-12 = Jan–Dec). Middle years are flat. Final year is the
 * remainder so the total sums to 100.
 */

const RES_RENTAL_MID_YEARS = 3.636;
const RES_RENTAL_LIFE = 27.5;
const RES_RENTAL_YEAR_1: readonly number[] = [
  3.485, 3.182, 2.879, 2.576, 2.273, 1.97, 1.667, 1.364, 1.061, 0.758, 0.455, 0.152,
];

const NONRES_REAL_MID_YEARS = 2.564;
const NONRES_REAL_LIFE = 39;
const NONRES_REAL_YEAR_1: readonly number[] = [
  2.461, 2.247, 2.033, 1.819, 1.605, 1.391, 1.177, 0.963, 0.749, 0.535, 0.321, 0.107,
];

/**
 * Build a full mid-month percentage schedule for a residential
 * (27.5y) or nonresidential-real (39y) property given the
 * placed-in-service month (1-12).
 */
function buildMidMonthSchedule(
  year1: readonly number[],
  midYearPct: number,
  lifeYears: number,
  placedInServiceMonth: number,
): number[] {
  if (placedInServiceMonth < 1 || placedInServiceMonth > 12) {
    throw new Error(`placedInServiceMonth must be 1-12, got ${placedInServiceMonth}`);
  }
  const y1 = year1[placedInServiceMonth - 1];
  if (y1 === undefined) throw new Error("unreachable");

  // Mid-month convention: year-1 covers (12.5 - month) months; remainder
  // is spread across N full mid-years + a final partial year. The number
  // of mid-years depends on the placed-in-service month:
  //   floor((life × 12 - (12.5 - month)) / 12)
  // Pub 946 Table A-6 (27.5y residential): 28 entries for months 1-6,
  // 29 entries for months 7-12. Table A-7a (39y nonres-real): 40 entries
  // regardless of month.
  const monthsLife = lifeYears * 12;
  const year1Months = 12.5 - placedInServiceMonth;
  const remainingMonths = monthsLife - year1Months;
  const fullMidYears = Math.floor(remainingMonths / 12);
  const result: number[] = [y1];
  let cumulative = new Decimal(y1);
  for (let i = 0; i < fullMidYears; i++) {
    result.push(midYearPct);
    cumulative = cumulative.plus(midYearPct);
  }
  const last = new Decimal(100).minus(cumulative);
  result.push(last.toNumber());
  return result;
}

export function residentialRentalSchedule(placedInServiceMonth: number): number[] {
  return buildMidMonthSchedule(
    RES_RENTAL_YEAR_1,
    RES_RENTAL_MID_YEARS,
    RES_RENTAL_LIFE,
    placedInServiceMonth,
  );
}

export function nonresidentialRealSchedule(placedInServiceMonth: number): number[] {
  return buildMidMonthSchedule(
    NONRES_REAL_YEAR_1,
    NONRES_REAL_MID_YEARS,
    NONRES_REAL_LIFE,
    placedInServiceMonth,
  );
}

/**
 * ADS straight-line schedule under half-year convention.
 *
 * Year 1 = 0.5 / lifeYears, year 2..lifeYears = 1/lifeYears,
 * final year = 0.5 / lifeYears (the remaining half-year).
 */
export function adsHalfYearSchedule(lifeYears: number): number[] {
  if (lifeYears <= 0 || !Number.isFinite(lifeYears)) {
    throw new Error(`ADS life must be positive, got ${lifeYears}`);
  }
  const fullPct = new Decimal(100).div(lifeYears);
  const halfPct = fullPct.div(2);
  const result: number[] = [halfPct.toNumber()];
  for (let y = 2; y <= lifeYears; y++) {
    result.push(fullPct.toNumber());
  }
  result.push(halfPct.toNumber());
  return result;
}

export type GdsPropertyClass = "3" | "5" | "7" | "10" | "15" | "20";

/** Look up the half-year GDS percentage table by class. */
export function gdsHalfYearTable(propertyClass: GdsPropertyClass): readonly number[] {
  const table = GDS_HALF_YEAR[propertyClass];
  if (!table) throw new Error(`No GDS half-year table for class ${propertyClass}`);
  return table;
}
