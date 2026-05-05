import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 19.8 — Social Security claiming-age optimizer.
 *
 * PIA from AIME via the bend-points formula:
 *   PIA = 90% × first bend + 32% × (AIME between bends) + 15% × above
 *
 * Bend points by year of first eligibility (62):
 *   2024 (born 1962): $1,174 / $7,078
 *   2025 (born 1963): $1,226 / $7,391
 *
 * FRA (Full Retirement Age):
 *   Born 1955: 66 + 2mo
 *   Born 1956: 66 + 4mo
 *   Born 1957: 66 + 6mo
 *   Born 1958: 66 + 8mo
 *   Born 1959: 66 + 10mo
 *   Born 1960+: 67
 *
 * Reductions for early claim:
 *   First 36 months before FRA: 5/9 of 1% per month (8.33%/year)
 *   Beyond 36 months: 5/12 of 1% per month (5%/year)
 *
 * Delayed retirement credits (DRC) for born 1943+: 8%/year past FRA, capped at age 70.
 */

const inputSchema = z
  .object({
    /** Average Indexed Monthly Earnings. */
    aime: z.number().nonnegative().finite(),
    /** Birth year (1955+ for FRA logic). */
    birthYear: z.number().int().min(1900).max(2025),
    /** Year of first eligibility (typically birthYear + 62). Drives bend points. */
    eligibilityYear: z.number().int().min(2024).max(2030),
    /** Claim age in years (62.0..70.0). */
    claimAgeYears: z.number().min(62).max(70),
    /** Comparison claim age (e.g., 67 or 70) — drives break-even. */
    comparisonClaimAge: z.number().min(62).max(70).optional(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  pia: z.number(),
  fraYears: z.number(),
  fraMonths: z.number(),
  monthlyBenefitAtClaim: z.number(),
  reductionOrCreditPct: z.number(),
  comparisonMonthly: z.number(),
  breakEvenAge: z.number(),
});

type Output = z.infer<typeof outputSchema>;

const BEND_POINTS_BY_YEAR: Record<number, { first: number; second: number }> = {
  2024: { first: 1_174, second: 7_078 },
  2025: { first: 1_226, second: 7_391 },
  2026: { first: 1_267, second: 7_634 },
  2027: { first: 1_300, second: 7_900 },
};

function fraForBirthYear(birthYear: number): { years: number; months: number } {
  if (birthYear <= 1954) return { years: 66, months: 0 };
  if (birthYear === 1955) return { years: 66, months: 2 };
  if (birthYear === 1956) return { years: 66, months: 4 };
  if (birthYear === 1957) return { years: 66, months: 6 };
  if (birthYear === 1958) return { years: 66, months: 8 };
  if (birthYear === 1959) return { years: 66, months: 10 };
  return { years: 67, months: 0 };
}

function piaFromAime(aime: number, eligibilityYear: number): number {
  const bp = BEND_POINTS_BY_YEAR[eligibilityYear];
  if (!bp) {
    throw new Error(`No bend points for eligibility year ${eligibilityYear}`);
  }
  const aimeD = new Decimal(aime);
  const tier1 = Decimal.min(aimeD, bp.first).times(0.9);
  const tier2 = Decimal.min(Decimal.max(0, aimeD.minus(bp.first)), bp.second - bp.first).times(
    0.32,
  );
  const tier3 = Decimal.max(0, aimeD.minus(bp.second)).times(0.15);
  // SSA POMS RS 00605.005: round PIA DOWN to the next lower $0.10
  // (i.e. truncate to one decimal place).
  return tier1.plus(tier2).plus(tier3).toDecimalPlaces(1, Decimal.ROUND_DOWN).toNumber();
}

function adjustForClaimAge(
  pia: number,
  claimAgeYears: number,
  fra: { years: number; months: number },
): { adjusted: number; pct: number } {
  const fraDecimalYears = fra.years + fra.months / 12;
  const monthsDiff = (claimAgeYears - fraDecimalYears) * 12;
  if (Math.abs(monthsDiff) < 0.01) return { adjusted: pia, pct: 0 };
  if (monthsDiff < 0) {
    // Early claim — reduction
    const monthsEarly = -monthsDiff;
    const first36 = Math.min(monthsEarly, 36);
    const beyond = Math.max(0, monthsEarly - 36);
    const reduction = first36 * (5 / 9) * 0.01 + beyond * (5 / 12) * 0.01;
    return {
      adjusted: new Decimal(pia)
        .times(1 - reduction)
        .toDecimalPlaces(2)
        .toNumber(),
      pct: -reduction,
    };
  }
  // Delayed claim — DRC 8%/year capped at age 70
  const monthsDelayed = Math.min(monthsDiff, (70 - fraDecimalYears) * 12);
  const drc = monthsDelayed * (8 / 12) * 0.01;
  return {
    adjusted: new Decimal(pia)
      .times(1 + drc)
      .toDecimalPlaces(2)
      .toNumber(),
    pct: drc,
  };
}

function breakEvenAge(monthlyA: number, ageA: number, monthlyB: number, ageB: number): number {
  // Find age T where cumulative benefits equate:
  //   monthlyA × (T - ageA) × 12 == monthlyB × (T - ageB) × 12
  if (Math.abs(monthlyA - monthlyB) < 0.01) return Number.POSITIVE_INFINITY;
  const numer = monthlyA * ageA - monthlyB * ageB;
  const denom = monthlyA - monthlyB;
  return numer / denom;
}

const socialSecurity: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.social_security",
    name: "Social Security claiming-age optimizer",
    description:
      "PIA from AIME via bend points; FRA based on birth year; reductions for claims before FRA, DRC for delays past FRA capped at 70; break-even age vs. a comparison claim age.",
    taxYears: [2024, 2025, 2026],
    formReferences: ["SSA Pub 05-10070", "SSA POMS RS 00605"],
    requiredTables: [],
  },
  inputSchema,
  outputSchema,
  validateInputs(raw: unknown): ValidationResult<Input> {
    const parsed = inputSchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  },
  compute(input) {
    const fra = fraForBirthYear(input.birthYear);
    const pia = piaFromAime(input.aime, input.eligibilityYear);
    const { adjusted: claimMonthly, pct } = adjustForClaimAge(pia, input.claimAgeYears, fra);
    const compareAge = input.comparisonClaimAge ?? fra.years + fra.months / 12;
    const { adjusted: compareMonthly } = adjustForClaimAge(pia, compareAge, fra);
    const be = breakEvenAge(claimMonthly, input.claimAgeYears, compareMonthly, compareAge);
    return {
      pia,
      fraYears: fra.years,
      fraMonths: fra.months,
      monthlyBenefitAtClaim: claimMonthly,
      reductionOrCreditPct: pct,
      comparisonMonthly: compareMonthly,
      breakEvenAge: Number.isFinite(be) ? Math.round(be * 100) / 100 : 999,
    };
  },
  narrate(input, output) {
    return (
      `Social Security: PIA $${output.pia.toLocaleString("en-US")}/mo at FRA ${output.fraYears}y${output.fraMonths}m. ` +
      `Claiming at age ${input.claimAgeYears}: $${output.monthlyBenefitAtClaim.toLocaleString("en-US")}/mo ` +
      `(${(output.reductionOrCreditPct * 100).toFixed(1)}%). ` +
      `Break-even vs. age ${input.comparisonClaimAge ?? `FRA`}: ${output.breakEvenAge}.`
    );
  },
};

registerCalculator(socialSecurity);

export { socialSecurity };
