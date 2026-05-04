import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 17.4 — Section 199A Qualified Business Income (QBI) deduction.
 *
 * Three regimes:
 *   1. Below threshold: simple 20% × QBI
 *   2. Within phase-in range: gradual blend of full 20% and W-2/UBIA-limited
 *      formula; SSTBs (Specified Service Trade or Business) phase out
 *      to zero
 *   3. Above threshold: SSTBs get $0 QBI; non-SSTBs are fully limited
 *      to greater of (50% × W-2 wages) or (25% × W-2 + 2.5% × UBIA)
 *
 * Then capped by overall taxable-income limit:
 *   QBI deduction ≤ 20% × (taxable income - net capital gain)
 *
 * REIT/PTP component computed separately and added.
 */

const inputSchema = z
  .object({
    /** Qualified business income from non-SSTB pass-through. */
    qbiFromNonSstb: z.number().finite().default(0),
    /** Qualified business income from SSTB. */
    qbiFromSstb: z.number().finite().default(0),
    /** Aggregate W-2 wages from QTBs (non-SSTB). */
    w2WagesNonSstb: z.number().nonnegative().finite().default(0),
    /** Unadjusted basis immediately after acquisition (UBIA) — non-SSTB. */
    ubiaNonSstb: z.number().nonnegative().finite().default(0),
    /** REIT dividends + qualified PTP income. */
    qualifiedReitPtpIncome: z.number().nonnegative().finite().default(0),
    /** Taxable income before the QBI deduction. */
    taxableIncomeBeforeQbi: z.number().nonnegative().finite(),
    /** Net capital gain (for the overall taxable-income limit). */
    netCapitalGain: z.number().nonnegative().finite().default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  thresholdStart: z.number(),
  phaseInRange: z.number(),
  thresholdEnd: z.number(),
  regime: z.enum(["below", "phase_in", "above"]),
  componentNonSstb: z.number(),
  componentSstb: z.number(),
  componentReitPtp: z.number(),
  preCapDeduction: z.number(),
  overallLimit: z.number(),
  qbiDeduction: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

interface QbiThresholds {
  single: number;
  mfj: number;
  mfs: number;
  hoh: number;
  qw?: number;
  phaseInRangeSingle: number;
  phaseInRangeMfj: number;
}

const FALLBACK_THRESHOLDS: Record<number, QbiThresholds> = {
  2024: {
    single: 191_950,
    mfj: 383_900,
    mfs: 191_950,
    hoh: 191_950,
    qw: 383_900,
    phaseInRangeSingle: 50_000,
    phaseInRangeMfj: 100_000,
  },
  2025: {
    single: 197_300,
    mfj: 394_600,
    mfs: 197_300,
    hoh: 197_300,
    qw: 394_600,
    phaseInRangeSingle: 50_000,
    phaseInRangeMfj: 100_000,
  },
};

interface ResolvedTableRow {
  source: "table" | "override";
  row: { payload: unknown };
}

function readThresholds(
  ctx: { tables: Map<TaxTableKind, unknown> },
  taxYear: number,
): QbiThresholds {
  const row = ctx.tables.get("qbi_thresholds") as ResolvedTableRow | null | undefined;
  if (
    row &&
    typeof row.row.payload === "object" &&
    row.row.payload !== null &&
    "single" in row.row.payload
  ) {
    return row.row.payload as unknown as QbiThresholds;
  }
  const fallback = FALLBACK_THRESHOLDS[taxYear];
  if (!fallback) throw new Error(`No QBI thresholds for tax year ${taxYear}`);
  return fallback;
}

function computeNonSstbComponent(
  qbi: Decimal,
  w2: Decimal,
  ubia: Decimal,
  regime: "below" | "phase_in" | "above",
  phaseInProgress: number,
): Decimal {
  if (qbi.lte(0)) return new Decimal(0);
  const fullDeduction = qbi.times(0.2);
  if (regime === "below") return fullDeduction;
  // W-2/UBIA limit: greater of (50% × W-2) or (25% × W-2 + 2.5% × UBIA)
  const limitA = w2.times(0.5);
  const limitB = w2.times(0.25).plus(ubia.times(0.025));
  const w2UbiaLimit = Decimal.max(limitA, limitB);
  if (regime === "above") return Decimal.min(fullDeduction, w2UbiaLimit);
  // Phase-in: deduction = fullDeduction - reduction × phaseInProgress
  // where reduction = fullDeduction - w2UbiaLimit (only if positive)
  const reduction = fullDeduction.minus(w2UbiaLimit);
  if (reduction.lte(0)) return fullDeduction;
  return fullDeduction.minus(reduction.times(phaseInProgress));
}

function computeSstbComponent(
  qbi: Decimal,
  w2: Decimal,
  ubia: Decimal,
  regime: "below" | "phase_in" | "above",
  phaseInProgress: number,
): Decimal {
  if (qbi.lte(0)) return new Decimal(0);
  if (regime === "below") return qbi.times(0.2);
  if (regime === "above") return new Decimal(0);
  // Phase-in: SSTB QBI is reduced by phaseInProgress, then run through
  // the non-SSTB phase-in formula on the reduced amounts.
  const sstbApplicableRatio = new Decimal(1).minus(phaseInProgress);
  const reducedQbi = qbi.times(sstbApplicableRatio);
  const reducedW2 = w2.times(sstbApplicableRatio);
  const reducedUbia = ubia.times(sstbApplicableRatio);
  return computeNonSstbComponent(reducedQbi, reducedW2, reducedUbia, "phase_in", phaseInProgress);
}

const qbi: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.qbi_199a",
    name: "Section 199A QBI deduction",
    description:
      "Qualified Business Income deduction including SSTB / non-SSTB phase-in, W-2 / UBIA limits, REIT/PTP add-on, and overall taxable-income cap. Per IRC §199A and Form 8995/8995-A instructions.",
    taxYears: [2024, 2025],
    formReferences: ["Form 8995", "Form 8995-A", "Pub 535"],
    requiredTables: ["qbi_thresholds"],
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
    const t = readThresholds(ctx, input.taxYear);
    const start =
      input.filingStatus === "mfj"
        ? t.mfj
        : input.filingStatus === "qss"
          ? (t.qw ?? t.mfj)
          : input.filingStatus === "hoh"
            ? t.hoh
            : input.filingStatus === "mfs"
              ? t.mfs
              : t.single;
    const range =
      input.filingStatus === "mfj" || input.filingStatus === "qss"
        ? t.phaseInRangeMfj
        : t.phaseInRangeSingle;
    const end = start + range;

    const ti = input.taxableIncomeBeforeQbi;
    const regime: "below" | "phase_in" | "above" =
      ti <= start ? "below" : ti >= end ? "above" : "phase_in";
    const phaseInProgress =
      regime === "phase_in" ? (ti - start) / range : regime === "above" ? 1 : 0;

    const nonSstbComp = computeNonSstbComponent(
      new Decimal(input.qbiFromNonSstb),
      new Decimal(input.w2WagesNonSstb),
      new Decimal(input.ubiaNonSstb),
      regime,
      phaseInProgress,
    );
    const sstbComp = computeSstbComponent(
      new Decimal(input.qbiFromSstb),
      new Decimal(input.w2WagesNonSstb), // SSTB taxpayers track separately, but for MVP we share input
      new Decimal(input.ubiaNonSstb),
      regime,
      phaseInProgress,
    );
    const reitComp = new Decimal(input.qualifiedReitPtpIncome).times(0.2);

    const preCap = nonSstbComp.plus(sstbComp).plus(reitComp);
    const overallLimit = new Decimal(input.taxableIncomeBeforeQbi)
      .minus(input.netCapitalGain)
      .times(0.2);
    const deduction = Decimal.max(0, Decimal.min(preCap, overallLimit));

    const notes: string[] = [];
    if (regime === "above" && input.qbiFromSstb > 0) {
      notes.push(
        "SSTB income is fully phased out at this taxable-income level — its QBI component is $0.",
      );
    }
    if (preCap.gt(overallLimit)) {
      notes.push(
        "Overall taxable-income limit (20% × (taxable income - net capital gain)) is binding.",
      );
    }

    return {
      thresholdStart: start,
      phaseInRange: range,
      thresholdEnd: end,
      regime,
      componentNonSstb: nonSstbComp.toDecimalPlaces(2).toNumber(),
      componentSstb: sstbComp.toDecimalPlaces(2).toNumber(),
      componentReitPtp: reitComp.toDecimalPlaces(2).toNumber(),
      preCapDeduction: preCap.toDecimalPlaces(2).toNumber(),
      overallLimit: overallLimit.toDecimalPlaces(2).toNumber(),
      qbiDeduction: deduction.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `QBI §199A deduction for ${input.taxYear}: $${output.qbiDeduction.toLocaleString("en-US")} ` +
      `(regime: ${output.regime}). Threshold start $${output.thresholdStart.toLocaleString("en-US")}, ` +
      `phase-in to $${output.thresholdEnd.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(qbi);

export { qbi };
