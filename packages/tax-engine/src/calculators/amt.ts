import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 19.1 — AMT (Alternative Minimum Tax) estimator.
 *
 * Form 6251 flow:
 *   1. Start: regular taxable income
 *   2. + Adjustments: state-tax deduction add-back, ISO bargain element, etc.
 *   3. + Preferences: percentage-depletion, certain accelerated dep
 *   4. = AMTI (Alternative Minimum Taxable Income)
 *   5. - AMT exemption (with phase-out at 25% × (AMTI - phaseout start))
 *   6. = Taxable AMTI
 *   7. × 26% (up to threshold) / 28% (above threshold)
 *   8. = TMT (Tentative Minimum Tax)
 *   9. AMT due = max(0, TMT - regular tax)
 *
 * 28% threshold (2024/2025): $232,600 (or $116,300 MFS).
 */

const inputSchema = z
  .object({
    regularTaxableIncome: z.number().nonnegative().finite(),
    regularTaxLiability: z.number().nonnegative().finite(),
    /** Add-backs (state tax, ISO bargain element, etc.). */
    amtAdjustments: z.number().nonnegative().finite().default(0),
    amtPreferences: z.number().nonnegative().finite().default(0),
    /** ISO exercise mode — bargain element flows into adjustments. */
    isoBargainElement: z.number().nonnegative().finite().default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  amti: z.number(),
  exemption: z.number(),
  exemptionPhaseout: z.number(),
  taxableAmti: z.number(),
  tmt: z.number(),
  regularTax: z.number(),
  amtDue: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

interface AmtPayload {
  single: number;
  mfj: number;
  mfs: number;
  phaseoutStartSingle: number;
  phaseoutStartMfj: number;
  phaseoutStartMfs: number;
}

const AMT_FALLBACK: Record<number, AmtPayload> = {
  2024: {
    single: 85_700,
    mfj: 133_300,
    mfs: 66_650,
    phaseoutStartSingle: 609_350,
    phaseoutStartMfj: 1_218_700,
    phaseoutStartMfs: 609_350,
  },
  2025: {
    single: 88_100,
    mfj: 137_000,
    mfs: 68_500,
    phaseoutStartSingle: 626_350,
    phaseoutStartMfj: 1_252_700,
    phaseoutStartMfs: 626_350,
  },
};

/** 28% bracket threshold (2024/2025) — published in Form 6251 instructions. */
const AMT_28_THRESHOLD: Record<number, { mfsHalf: number; full: number }> = {
  2024: { mfsHalf: 116_300, full: 232_600 },
  2025: { mfsHalf: 119_550, full: 239_100 },
};

interface ResolvedTableRow {
  source: "table" | "override";
  row: { payload: unknown };
}

function readAmtPayload(ctx: { tables: Map<TaxTableKind, unknown> }, taxYear: number): AmtPayload {
  const row = ctx.tables.get("alternative_minimum_tax_exemption") as
    | ResolvedTableRow
    | null
    | undefined;
  if (
    row &&
    typeof row.row.payload === "object" &&
    row.row.payload !== null &&
    "single" in row.row.payload
  ) {
    return row.row.payload as unknown as AmtPayload;
  }
  const fallback = AMT_FALLBACK[taxYear];
  if (!fallback) throw new Error(`No AMT exemption table for ${taxYear}`);
  return fallback;
}

const amt: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.amt",
    name: "AMT estimator",
    description:
      "Alternative Minimum Tax via Form 6251: AMTI build-up, exemption + phase-out at 25%, 26%/28% TMT brackets, ISO-exercise mode.",
    taxYears: [2024, 2025],
    formReferences: ["Form 6251", "Pub 550"],
    requiredTables: ["alternative_minimum_tax_exemption"],
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
    const t = readAmtPayload(ctx, input.taxYear);
    const baseExemption =
      input.filingStatus === "mfj" || input.filingStatus === "qss"
        ? t.mfj
        : input.filingStatus === "mfs"
          ? t.mfs
          : t.single;
    const phaseoutStart =
      input.filingStatus === "mfj" || input.filingStatus === "qss"
        ? t.phaseoutStartMfj
        : input.filingStatus === "mfs"
          ? t.phaseoutStartMfs
          : t.phaseoutStartSingle;

    const amti = new Decimal(input.regularTaxableIncome)
      .plus(input.amtAdjustments)
      .plus(input.amtPreferences)
      .plus(input.isoBargainElement);

    // Phase-out: exemption reduced by 25 cents per dollar AMTI over phaseout start
    const overStart = Decimal.max(0, amti.minus(phaseoutStart));
    const phaseout = overStart.times(0.25);
    const exemption = Decimal.max(0, new Decimal(baseExemption).minus(phaseout));

    const taxableAmti = Decimal.max(0, amti.minus(exemption));

    // TMT: 26% × taxableAmti up to threshold, 28% above
    const thresholds = AMT_28_THRESHOLD[input.taxYear];
    if (!thresholds) throw new Error(`No AMT 28% threshold for ${input.taxYear}`);
    const threshold = input.filingStatus === "mfs" ? thresholds.mfsHalf : thresholds.full;

    const lowerBracket = Decimal.min(taxableAmti, threshold);
    const upperBracket = Decimal.max(0, taxableAmti.minus(threshold));
    const tmt = lowerBracket.times(0.26).plus(upperBracket.times(0.28));

    const amtDue = Decimal.max(0, tmt.minus(input.regularTaxLiability));

    const notes: string[] = [];
    if (input.isoBargainElement > 0) {
      notes.push(
        `ISO bargain element of $${input.isoBargainElement.toLocaleString("en-US")} added to AMTI. Track AMT basis adjustment for the year of sale (Form 6251 line 2k).`,
      );
    }
    if (phaseout.gt(0)) {
      notes.push(
        `Exemption phased out by $${phaseout.toDecimalPlaces(0).toString()} (25% × AMTI excess over $${phaseoutStart.toLocaleString("en-US")}).`,
      );
    }
    if (amtDue.gt(0)) {
      notes.push(
        "AMT applies — TMT exceeds regular tax. The excess is added to Form 1040 line 17.",
      );
    }

    return {
      amti: amti.toDecimalPlaces(2).toNumber(),
      exemption: exemption.toDecimalPlaces(2).toNumber(),
      exemptionPhaseout: phaseout.toDecimalPlaces(2).toNumber(),
      taxableAmti: taxableAmti.toDecimalPlaces(2).toNumber(),
      tmt: tmt.toDecimalPlaces(2).toNumber(),
      regularTax: input.regularTaxLiability,
      amtDue: amtDue.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    if (output.amtDue === 0) {
      return `No AMT due for ${input.taxYear}: TMT $${output.tmt.toLocaleString("en-US")} ≤ regular tax $${output.regularTax.toLocaleString("en-US")}.`;
    }
    return (
      `AMT due for ${input.taxYear}: $${output.amtDue.toLocaleString("en-US")} ` +
      `(TMT $${output.tmt.toLocaleString("en-US")} - regular tax $${output.regularTax.toLocaleString("en-US")}). ` +
      `AMTI $${output.amti.toLocaleString("en-US")}, exemption after phase-out $${output.exemption.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(amt);

export { amt };
