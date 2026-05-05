import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 18.2 — Self-employment tax (Schedule SE).
 *
 * Computation:
 *   1. Net SE earnings × 92.35% (the 7.65% employer-half deduction
 *      already reflected on the income side)
 *   2. OASDI portion: 12.4% × min(SE earnings, wage base - W-2 wages
 *      already subject to OASDI)
 *   3. Medicare portion: 2.9% × full SE earnings (no cap)
 *   4. Additional Medicare: 0.9% × (combined wages + SE earnings -
 *      additional-medicare threshold), only on the SE portion
 *      that pushes above the threshold
 *   5. Half-SE deduction = SE tax / 2 (above-the-line, Form 1040
 *      Schedule 1)
 *
 * Wage base + thresholds sourced from `fica_wage_base` and
 * `medicare_thresholds` rate tables.
 */

const inputSchema = z
  .object({
    /** Schedule C / partnership SE net earnings BEFORE the 92.35% multiplier. */
    netSeEarnings: z.number().finite(),
    /** W-2 wages already subject to OASDI (caps the OASDI base). */
    w2WagesSubjectToOasdi: z.number().nonnegative().finite().default(0),
    /** Combined W-2 wages (drives Additional Medicare 0.9%). */
    w2WagesTotal: z.number().nonnegative().finite().default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  netSeEarningsAfterMultiplier: z.number(),
  oasdiBase: z.number(),
  oasdiTax: z.number(),
  medicareTax: z.number(),
  additionalMedicareTax: z.number(),
  totalSeTax: z.number(),
  halfSeDeduction: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

interface FicaPayload {
  wageBase: number;
  oasdiRate: number;
  medicareRate: number;
  additionalMedicareRate: number;
}

interface ResolvedTableRow {
  source: "table" | "override";
  row: { payload: unknown };
}

const FICA_FALLBACK: Record<number, FicaPayload> = {
  2024: {
    wageBase: 168_600,
    oasdiRate: 0.062,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
  },
  2025: {
    wageBase: 176_100,
    oasdiRate: 0.062,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
  },
};

const ADDL_MEDICARE_THRESHOLDS: Record<string, number> = {
  single: 200_000,
  mfj: 250_000,
  mfs: 125_000,
  hoh: 200_000,
  qss: 250_000,
};

function readFica(ctx: { tables: Map<TaxTableKind, unknown> }, taxYear: number): FicaPayload {
  const row = ctx.tables.get("fica_wage_base") as ResolvedTableRow | null | undefined;
  if (
    row &&
    typeof row.row.payload === "object" &&
    row.row.payload !== null &&
    "wageBase" in row.row.payload
  ) {
    return row.row.payload as unknown as FicaPayload;
  }
  const fallback = FICA_FALLBACK[taxYear];
  if (!fallback) throw new Error(`No FICA wage base for tax year ${taxYear}`);
  return fallback;
}

const seTax: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.se_tax",
    name: "Self-employment tax",
    description:
      "Schedule SE: 92.35% multiplier; 12.4% OASDI to wage base (less W-2 OASDI wages); 2.9% Medicare uncapped; 0.9% Additional Medicare above threshold; half-SE deduction.",
    taxYears: [2024, 2025],
    formReferences: ["Schedule SE", "Form 1040 Schedule 1", "Pub 334"],
    requiredTables: ["fica_wage_base"],
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
    const fica = readFica(ctx, input.taxYear);
    const notes: string[] = [];
    const seGross = new Decimal(input.netSeEarnings);
    const seNet = seGross.times(0.9235);
    // Schedule SE Part I: no SE tax if **net** SE earnings (after the
    // 92.35% multiplier) are < $400. Test net, not gross.
    if (seNet.lt(400)) {
      notes.push("Net SE earnings < $400 — no SE tax due (Schedule SE Part I exception).");
      return {
        netSeEarningsAfterMultiplier: seNet.toDecimalPlaces(2).toNumber(),
        oasdiBase: 0,
        oasdiTax: 0,
        medicareTax: 0,
        additionalMedicareTax: 0,
        totalSeTax: 0,
        halfSeDeduction: 0,
        notes,
      };
    }

    // OASDI base = min(SE earnings, wage base - W-2 OASDI wages)
    const remainingOasdiRoom = Decimal.max(
      0,
      new Decimal(fica.wageBase).minus(input.w2WagesSubjectToOasdi),
    );
    const oasdiBase = Decimal.min(seNet, remainingOasdiRoom);
    const oasdi = oasdiBase.times(0.124).toDecimalPlaces(2);

    // Medicare 2.9% on full SE earnings
    const medicare = seNet.times(0.029).toDecimalPlaces(2);

    // Additional Medicare: 0.9% on combined wages + SE earnings above threshold
    const threshold = ADDL_MEDICARE_THRESHOLDS[input.filingStatus] ?? 200_000;
    const combinedWageBase = new Decimal(input.w2WagesTotal).plus(seNet);
    const excessOverThreshold = Decimal.max(0, combinedWageBase.minus(threshold));
    // Only the SE portion gets reported here (W-2 portion is withheld by employer).
    const seOverThreshold = Decimal.min(excessOverThreshold, seNet);
    const additionalMedicare = seOverThreshold.times(0.009).toDecimalPlaces(2);

    const total = oasdi.plus(medicare).plus(additionalMedicare);
    const halfSe = oasdi.plus(medicare).div(2).toDecimalPlaces(2);

    return {
      netSeEarningsAfterMultiplier: seNet.toDecimalPlaces(2).toNumber(),
      oasdiBase: oasdiBase.toDecimalPlaces(2).toNumber(),
      oasdiTax: oasdi.toNumber(),
      medicareTax: medicare.toNumber(),
      additionalMedicareTax: additionalMedicare.toNumber(),
      totalSeTax: total.toDecimalPlaces(2).toNumber(),
      halfSeDeduction: halfSe.toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `SE tax for ${input.taxYear} on $${input.netSeEarnings.toLocaleString("en-US")} net SE earnings: ` +
      `$${output.totalSeTax.toLocaleString("en-US")} total (OASDI $${output.oasdiTax.toLocaleString("en-US")}, ` +
      `Medicare $${output.medicareTax.toLocaleString("en-US")}, ` +
      `Additional Medicare $${output.additionalMedicareTax.toLocaleString("en-US")}). ` +
      `Half-SE deduction: $${output.halfSeDeduction.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(seTax);

export { seTax };
