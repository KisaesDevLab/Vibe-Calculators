import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 19.4 — IRC §121 home-sale exclusion.
 *
 * Rules:
 *   - Exclusion: $250,000 single / $500,000 MFJ (per sale)
 *   - Ownership: owned the home ≥ 2 of last 5 years
 *   - Use: used as principal residence ≥ 2 of last 5 years
 *   - Frequency: only one §121 exclusion per 2 years
 *   - Nonqualified-use post-2008-12-31: ratio reduces exclusion
 *     (rentals before primary residence, etc.)
 *   - Partial exclusion: if sale due to work, health, or unforeseen
 *     circumstances → fraction of full exclusion based on shorter
 *     of (months met) / 24
 */

const inputSchema = z
  .object({
    salePrice: z.number().positive().finite(),
    adjustedBasis: z.number().nonnegative().finite(),
    sellingExpenses: z.number().nonnegative().finite().default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    /** Months of qualified ownership in the 5-year window prior to sale. */
    monthsOwned: z.number().int().min(0).max(60),
    /** Months of qualified use as principal residence in the 5-year window. */
    monthsUsed: z.number().int().min(0).max(60),
    /** Used the §121 exclusion within prior 24 months? */
    usedExclusionInLast24Months: z.boolean().default(false),
    /** Months of nonqualified use (rental, etc.) post-2008-12-31. */
    monthsNonqualifiedUse: z.number().int().min(0).default(0),
    /** Total months of ownership (denominator for nonqualified-use ratio). */
    totalMonthsOwned: z.number().int().min(0).default(0),
    /** Partial exclusion qualifier (work / health / unforeseen). */
    partialExclusionReason: z.enum(["none", "work", "health", "unforeseen"]).default("none"),
    /** Months of qualified use prior to sale (for partial-exclusion fraction). */
    partialMonthsCount: z.number().int().min(0).max(24).default(0),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  realizedGain: z.number(),
  fullStatutoryExclusion: z.number(),
  ownershipTestPassed: z.boolean(),
  useTestPassed: z.boolean(),
  frequencyTestPassed: z.boolean(),
  nonqualifiedUseRatio: z.number(),
  exclusionAvailable: z.number(),
  taxableGain: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const section121: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.section_121",
    name: "§121 home-sale exclusion",
    description:
      "Computes IRC §121 exclusion ($250k single / $500k MFJ): ownership/use/frequency tests, nonqualified-use ratio, partial-exclusion fraction.",
    taxYears: [2024, 2025],
    formReferences: ["Pub 523", "Form 8949"],
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
    const realized = new Decimal(input.salePrice)
      .minus(input.adjustedBasis)
      .minus(input.sellingExpenses);

    const isMfj = input.filingStatus === "mfj" || input.filingStatus === "qss";
    const fullStatutory = isMfj ? 500_000 : 250_000;

    const ownershipPassed = input.monthsOwned >= 24;
    const usePassed = input.monthsUsed >= 24;
    const frequencyPassed = !input.usedExclusionInLast24Months;
    const allTestsPassed = ownershipPassed && usePassed && frequencyPassed;

    let exclusionAvailable = new Decimal(0);
    const notes: string[] = [];

    if (allTestsPassed) {
      exclusionAvailable = new Decimal(fullStatutory);
    } else if (input.partialExclusionReason !== "none") {
      // Partial exclusion: full × (months met / 24)
      const fraction = new Decimal(input.partialMonthsCount).div(24);
      exclusionAvailable = new Decimal(fullStatutory).times(fraction);
      notes.push(
        `Partial exclusion under §121(c) (${input.partialExclusionReason}): ${input.partialMonthsCount}/24 months × $${fullStatutory.toLocaleString("en-US")} = $${exclusionAvailable.toDecimalPlaces(0).toString()}.`,
      );
    } else {
      notes.push(
        `Tests failed: ownership ${ownershipPassed ? "OK" : "FAIL"}, use ${usePassed ? "OK" : "FAIL"}, frequency ${frequencyPassed ? "OK" : "FAIL"}. No exclusion (and no partial-exclusion qualifier).`,
      );
    }

    // Nonqualified-use ratio (post-2008-12-31)
    let nqRatio = 0;
    if (input.monthsNonqualifiedUse > 0 && input.totalMonthsOwned > 0) {
      nqRatio = input.monthsNonqualifiedUse / input.totalMonthsOwned;
      const reducedByNqRatio = exclusionAvailable.times(1 - nqRatio);
      const reduction = exclusionAvailable.minus(reducedByNqRatio);
      if (reduction.gt(0)) {
        notes.push(
          `Nonqualified-use ratio ${(nqRatio * 100).toFixed(2)}% reduces exclusion by $${reduction.toDecimalPlaces(2).toString()}.`,
        );
      }
      exclusionAvailable = reducedByNqRatio;
    }

    const taxable = Decimal.max(0, realized.minus(exclusionAvailable));

    return {
      realizedGain: realized.toDecimalPlaces(2).toNumber(),
      fullStatutoryExclusion: fullStatutory,
      ownershipTestPassed: ownershipPassed,
      useTestPassed: usePassed,
      frequencyTestPassed: frequencyPassed,
      nonqualifiedUseRatio: nqRatio,
      exclusionAvailable: exclusionAvailable.toDecimalPlaces(2).toNumber(),
      taxableGain: taxable.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `§121 home-sale: realized $${output.realizedGain.toLocaleString("en-US")}, ` +
      `exclusion available $${output.exclusionAvailable.toLocaleString("en-US")}, ` +
      `taxable gain $${output.taxableGain.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(section121);

export { section121 };
