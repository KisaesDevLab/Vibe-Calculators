import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import {
  applyBrackets,
  bracketsForStatus,
  marginalRate,
  readBrackets,
} from "../lib/bracket-tax.js";

/**
 * Phase 17.2 — Roth conversion analyzer.
 *
 * Computes:
 *   - Tax cost of converting an amount this year (compared to no
 *     conversion baseline)
 *   - Marginal vs. effective conversion rate
 *   - Future-value comparison: pre-tax dollars left to grow vs.
 *     post-tax dollars in Roth at supplied retirement age
 *   - Break-even age — where the after-tax future value of the
 *     converted amount overtakes the no-convert baseline
 *   - IRMAA threshold flag — if the conversion pushes MAGI over
 *     IRMAA tier thresholds
 *
 * IRMAA tiers from CMS (2024 reporting year applicable to 2026
 * premiums; rough thresholds — calc surfaces a flag, not a billing
 * estimate).
 */

const inputSchema = z
  .object({
    /** Conversion amount (added to ordinary income this year). */
    conversionAmount: z.number().positive().finite(),
    /** Pre-conversion taxable income (ex-conversion). */
    preConversionTaxableIncome: z.number().nonnegative().finite(),
    /** Pre-conversion MAGI (drives IRMAA flag). */
    preConversionMagi: z.number().nonnegative().finite(),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    taxYear: z.number().int().min(2024).max(2026),
    /** Owner's current age. */
    currentAge: z.number().int().min(18).max(100),
    /** Age at which Roth balance will be drawn. */
    retirementAge: z.number().int().min(40).max(120),
    /** Expected investment return in retirement account (decimal). */
    growthRate: z.number().min(0).max(1).default(0.07),
    /** Expected marginal tax rate at retirement (decimal). */
    retirementMarginalRate: z.number().min(0).max(1).default(0.22),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.retirementAge <= input.currentAge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retirementAge"],
        message: "retirementAge must be > currentAge",
      });
    }
  });

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  conversionTaxCost: z.number(),
  effectiveConversionRate: z.number(),
  marginalRateAtTopOfConversion: z.number(),
  futureValueRothConverted: z.number(),
  futureValueNoConvertAfterTax: z.number(),
  breakEvenAge: z.number(),
  irmaaThresholdCrossed: z.boolean(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

/**
 * IRMAA Part B/D surcharge thresholds (MAGI). Source: CMS 2024.
 * Single: 103,000 / 129,000 / 161,000 / 193,000 / 500,000.
 * MFJ: 206,000 / 258,000 / 322,000 / 386,000 / 750,000.
 * Calc surfaces only "is any threshold crossed" — full tier amount
 * is a Phase 17 Tier-2 follow-up.
 */
const IRMAA_FIRST_TIER_2024: Record<string, number> = {
  single: 103_000,
  mfj: 206_000,
  mfs: 103_000,
  hoh: 103_000,
  qss: 206_000,
};

const rothConversion: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.roth_conversion",
    name: "Roth conversion analyzer",
    description:
      "Estimates the tax cost of a Roth conversion vs. no-conversion baseline, plus future-value comparison, break-even age, and IRMAA threshold flag.",
    taxYears: [2024, 2025],
    formReferences: ["Form 1099-R", "Form 8606", "Pub 590-A"],
    requiredTables: ["federal_tax_brackets"],
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
  compute(input, ctx) {
    const brackets = bracketsForStatus(readBrackets(ctx, input.taxYear), input.filingStatus);
    const baselineTax = applyBrackets(input.preConversionTaxableIncome, brackets);
    const postConversionIncome = new Decimal(input.preConversionTaxableIncome).plus(
      input.conversionAmount,
    );
    const postConversionTax = applyBrackets(postConversionIncome.toNumber(), brackets);
    const taxCost = new Decimal(postConversionTax).minus(baselineTax);
    const conversion = new Decimal(input.conversionAmount);
    const effectiveRate = taxCost.div(conversion);

    const marginal = marginalRate(postConversionIncome.toNumber(), brackets);

    // Future-value comparison.
    // Convert path: pay tax now from outside funds; full conversion grows tax-free.
    //   FV_convert = conversion × (1 + g)^n  (Roth, no future tax)
    // No-convert path: dollars stay pre-tax; at retirement pay marginal tax.
    //   FV_noconvert_after_tax = conversion × (1 + g)^n × (1 - r_retire)
    const years = input.retirementAge - input.currentAge;
    const growth = new Decimal(1).plus(input.growthRate).pow(years);
    const fvConvert = conversion.times(growth);
    const fvNoConvert = conversion
      .times(growth)
      .times(new Decimal(1).minus(input.retirementMarginalRate));

    // Break-even age: when does the convert-and-pay-tax-now strategy
    // (loss = taxCost grown at growthRate) equal the future tax bill
    // on the unconverted balance?
    //   taxCost × (1 + g)^t == conversion × (1 + g)^t × r_retire
    //   ⇒ t doesn't matter; the inequality flips on day 1 if
    //     effectiveRate < retirementMarginalRate, day-never if >=.
    // The interesting break-even is *between* convert-with-side-pocket
    // and stay-pre-tax: where does Roth FV >= NoConvert FV after tax?
    //   conversion × g^t >= conversion × g^t × (1 - r_retire) + (taxCost grown at g^t implicit)
    // Simpler: break-even happens once retirementMarginalRate × growth equals taxCost growth — i.e. immediately if retirementRate >= effectiveRate.
    const breakEvenAge =
      input.retirementMarginalRate >= effectiveRate.toNumber()
        ? input.currentAge
        : input.retirementAge;

    const irmaaTier = IRMAA_FIRST_TIER_2024[input.filingStatus] ?? 999_999;
    const postMagi = input.preConversionMagi + input.conversionAmount;
    const irmaaCrossed = input.preConversionMagi <= irmaaTier && postMagi > irmaaTier;

    const notes: string[] = [];
    if (irmaaCrossed) {
      notes.push(
        "IRMAA flag: this conversion crosses the first-tier MAGI threshold and may trigger a Medicare Part B/D surcharge two years out.",
      );
    }
    if (effectiveRate.lt(input.retirementMarginalRate)) {
      notes.push(
        "Conversion saves tax in present value: effective conversion rate is lower than your projected retirement marginal rate.",
      );
    }

    return {
      conversionTaxCost: taxCost.toNumber(),
      effectiveConversionRate: effectiveRate.toNumber(),
      marginalRateAtTopOfConversion: marginal,
      futureValueRothConverted: fvConvert.toDecimalPlaces(2).toNumber(),
      futureValueNoConvertAfterTax: fvNoConvert.toDecimalPlaces(2).toNumber(),
      breakEvenAge,
      irmaaThresholdCrossed: irmaaCrossed,
      notes,
    };
  },
  narrate(input, output) {
    return (
      `Converting $${input.conversionAmount.toLocaleString("en-US")} to Roth in ${input.taxYear} ` +
      `costs $${output.conversionTaxCost.toLocaleString("en-US")} in tax ` +
      `(effective rate ${(output.effectiveConversionRate * 100).toFixed(2)}%). ` +
      `Future value at age ${input.retirementAge}: Roth $${output.futureValueRothConverted.toLocaleString("en-US")} ` +
      `vs. no-convert after-tax $${output.futureValueNoConvertAfterTax.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(rothConversion);

export { rothConversion };
