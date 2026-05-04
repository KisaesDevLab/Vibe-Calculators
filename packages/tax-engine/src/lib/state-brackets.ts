/**
 * Phase 18.3 — state income-tax quick-estimator brackets.
 *
 * MVP states (per build plan):
 *   - MO (primary), CA, NY, IL, PA, OH, GA, NC, AZ
 *   - FL, TX (no income tax — N/A)
 *
 * Brackets sourced from each state's 2025 published schedule. Where
 * the state offers a flat rate (IL, PA, NC, AZ, GA, OH on most
 * income), it's modeled as a single open bracket at that rate.
 *
 * Disclaimer surfaced in narrate(): "approximate; not a substitute
 * for state form prep."
 */

export interface StateBracket {
  rate: number;
  upto: number | null;
}

export interface StateSchedule {
  state: string;
  hasIncomeTax: boolean;
  /** A standard deduction amount used by the calc (single). MFJ doubles. */
  standardDeductionSingle?: number;
  brackets?: StateBracket[];
}

/**
 * 2025 state schedules. Single-filer column (MFJ uses the same
 * brackets in many states; the calc applies the standard deduction
 * × 2 for MFJ).
 *
 * Sources:
 *   - MO: https://dor.mo.gov/forms/2025-Tax-Rate-Charts.pdf
 *   - CA: FTB schedule X (2024 used as fallback for 2025 — annual update)
 *   - NY: NY DTF 2024 IT-201 schedule
 *   - IL: 4.95% flat
 *   - PA: 3.07% flat
 *   - OH: 2025 schedule (top rate 3.5%)
 *   - GA: 5.39% flat (2024 transition; 5.19% post-2025 if cuts apply)
 *   - NC: 4.5% flat (2024)
 *   - AZ: 2.5% flat
 */
export const STATE_SCHEDULES_2025: Record<string, StateSchedule> = {
  MO: {
    state: "Missouri",
    hasIncomeTax: true,
    standardDeductionSingle: 14_600,
    brackets: [
      { rate: 0, upto: 1_273 },
      { rate: 0.02, upto: 2_546 },
      { rate: 0.025, upto: 3_819 },
      { rate: 0.03, upto: 5_092 },
      { rate: 0.035, upto: 6_365 },
      { rate: 0.04, upto: 7_638 },
      { rate: 0.045, upto: 8_911 },
      { rate: 0.047, upto: null },
    ],
  },
  CA: {
    state: "California",
    hasIncomeTax: true,
    standardDeductionSingle: 5_540,
    brackets: [
      { rate: 0.01, upto: 10_756 },
      { rate: 0.02, upto: 25_499 },
      { rate: 0.04, upto: 40_245 },
      { rate: 0.06, upto: 55_866 },
      { rate: 0.08, upto: 70_606 },
      { rate: 0.093, upto: 360_659 },
      { rate: 0.103, upto: 432_787 },
      { rate: 0.113, upto: 721_314 },
      { rate: 0.123, upto: null },
    ],
  },
  NY: {
    state: "New York",
    hasIncomeTax: true,
    standardDeductionSingle: 8_000,
    brackets: [
      { rate: 0.04, upto: 8_500 },
      { rate: 0.045, upto: 11_700 },
      { rate: 0.0525, upto: 13_900 },
      { rate: 0.055, upto: 80_650 },
      { rate: 0.06, upto: 215_400 },
      { rate: 0.0685, upto: 1_077_550 },
      { rate: 0.0965, upto: 5_000_000 },
      { rate: 0.103, upto: 25_000_000 },
      { rate: 0.109, upto: null },
    ],
  },
  IL: {
    state: "Illinois",
    hasIncomeTax: true,
    standardDeductionSingle: 0,
    brackets: [{ rate: 0.0495, upto: null }],
  },
  PA: {
    state: "Pennsylvania",
    hasIncomeTax: true,
    standardDeductionSingle: 0,
    brackets: [{ rate: 0.0307, upto: null }],
  },
  OH: {
    state: "Ohio",
    hasIncomeTax: true,
    standardDeductionSingle: 0,
    brackets: [
      { rate: 0, upto: 26_050 },
      { rate: 0.0275, upto: 100_000 },
      { rate: 0.035, upto: null },
    ],
  },
  GA: {
    state: "Georgia",
    hasIncomeTax: true,
    standardDeductionSingle: 12_000,
    brackets: [{ rate: 0.0539, upto: null }],
  },
  NC: {
    state: "North Carolina",
    hasIncomeTax: true,
    standardDeductionSingle: 12_750,
    brackets: [{ rate: 0.045, upto: null }],
  },
  AZ: {
    state: "Arizona",
    hasIncomeTax: true,
    standardDeductionSingle: 14_600,
    brackets: [{ rate: 0.025, upto: null }],
  },
  FL: { state: "Florida", hasIncomeTax: false },
  TX: { state: "Texas", hasIncomeTax: false },
};
