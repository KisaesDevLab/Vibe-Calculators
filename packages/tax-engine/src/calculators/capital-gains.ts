import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 17.3 — Capital gains / loss harvesting.
 *
 * Computes per-lot:
 *   - Holding period (short ≤ 1y, long > 1y)
 *   - Realized gain/loss
 *   - QSBS exclusion (§1202): 50% (1993-09-27 to 2010-02-17),
 *     75% (2010-02-18 to 2010-09-27), 100% (2010-09-28+)
 *   - Wash-sale flag (sale at loss with replacement purchase
 *     within ±30 days)
 *
 * Aggregate output:
 *   - Net short-term gain/loss
 *   - Net long-term gain/loss
 *   - NIIT 3.8% surtax on net investment income above MAGI threshold
 *   - Carryover loss tracker (capped at $3,000 ordinary offset / yr)
 */

const lotSchema = z.object({
  lotId: z.string().min(1),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costBasis: z.number().nonnegative().finite(),
  saleProceeds: z.number().nonnegative().finite(),
  /** Mark this lot as QSBS (Qualified Small Business Stock §1202). */
  isQsbs: z.boolean().default(false),
  /** Replacement-purchase dates for wash-sale detection (±30 days). */
  replacementPurchaseDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});

const inputSchema = z
  .object({
    lots: z.array(lotSchema).min(1),
    /** Modified AGI for NIIT threshold check. */
    magi: z.number().nonnegative().finite(),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    /** Prior-year capital-loss carryover (positive number). */
    priorLossCarryover: z.number().nonnegative().finite().default(0),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const lotResultSchema = z.object({
  lotId: z.string(),
  holdingPeriodDays: z.number(),
  isLongTerm: z.boolean(),
  realizedGain: z.number(),
  qsbsExclusionPct: z.number(),
  qsbsExcludedAmount: z.number(),
  taxableGain: z.number(),
  washSaleFlag: z.boolean(),
});

const outputSchema = z.object({
  perLot: z.array(lotResultSchema),
  netShortTermGain: z.number(),
  netLongTermGain: z.number(),
  totalCapitalGain: z.number(),
  ordinaryLossOffset: z.number(),
  carryoverToNextYear: z.number(),
  netInvestmentIncomeTax: z.number(),
  niitThresholdApplied: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const NIIT_THRESHOLD: Record<string, number> = {
  single: 200_000,
  mfj: 250_000,
  mfs: 125_000,
  hoh: 200_000,
  qss: 250_000,
};

const ONE_DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / ONE_DAY_MS);
}

function qsbsExclusionPct(acquisitionDate: string): number {
  const ms = Date.parse(`${acquisitionDate}T00:00:00Z`);
  const t1 = Date.parse("1993-09-28T00:00:00Z");
  const t2 = Date.parse("2010-02-18T00:00:00Z");
  const t3 = Date.parse("2010-09-28T00:00:00Z");
  if (ms < t1) return 0;
  if (ms < t2) return 0.5;
  if (ms < t3) return 0.75;
  return 1.0;
}

function isWashSale(
  realized: Decimal,
  saleDate: string,
  replacementDates: readonly string[],
): boolean {
  if (realized.gte(0)) return false;
  for (const r of replacementDates) {
    const d = Math.abs(daysBetween(saleDate, r));
    if (d <= 30) return true;
  }
  return false;
}

const capitalGains: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.capital_gains",
    name: "Capital gains / loss harvesting",
    description:
      "Per-lot gain/loss with short-vs-long classification, QSBS §1202 exclusion, wash-sale detection, and NIIT 3.8% surtax. Per IRC §1(h)/§1202/§1411, Pub 550.",
    taxYears: [2024, 2025],
    formReferences: ["Form 8949", "Schedule D", "Form 8960"],
    requiredTables: ["niit_thresholds"],
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
    const perLot: Output["perLot"] = [];
    let netShort = new Decimal(0);
    let netLong = new Decimal(0);
    const notes: string[] = [];

    for (const lot of input.lots) {
      const days = daysBetween(lot.acquisitionDate, lot.saleDate);
      const isLong = days > 365;
      const realized = new Decimal(lot.saleProceeds).minus(lot.costBasis);
      const qsbsPct = lot.isQsbs && isLong ? qsbsExclusionPct(lot.acquisitionDate) : 0;
      const qsbsExcluded = realized.gt(0)
        ? realized.times(qsbsPct).toDecimalPlaces(2)
        : new Decimal(0);
      const taxable = realized.minus(qsbsExcluded);
      const wash = isWashSale(realized, lot.saleDate, lot.replacementPurchaseDates);
      const effectiveTaxable = wash ? new Decimal(0) : taxable;

      perLot.push({
        lotId: lot.lotId,
        holdingPeriodDays: days,
        isLongTerm: isLong,
        realizedGain: realized.toNumber(),
        qsbsExclusionPct: qsbsPct,
        qsbsExcludedAmount: qsbsExcluded.toNumber(),
        taxableGain: effectiveTaxable.toNumber(),
        washSaleFlag: wash,
      });

      if (wash) {
        notes.push(
          `Lot ${lot.lotId}: wash-sale loss disallowed; basis adjustment to replacement lot is required (out of scope of this calc).`,
        );
        continue;
      }
      if (isLong) netLong = netLong.plus(effectiveTaxable);
      else netShort = netShort.plus(effectiveTaxable);
    }

    // Net the two buckets, then apply prior carryover.
    let total = netShort.plus(netLong);
    let ordinaryOffset = new Decimal(0);
    let carryover = new Decimal(0);
    const carryIn = new Decimal(input.priorLossCarryover);

    if (total.gte(0)) {
      // Use carryover against gain first.
      const used = Decimal.min(carryIn, total);
      total = total.minus(used);
      carryover = carryIn.minus(used);
    } else {
      // Net loss this year. Apply ordinary-income offset (cap $3k or $1.5k MFS).
      const cap = input.filingStatus === "mfs" ? 1500 : 3000;
      const loss = total.abs();
      const useOrdinary = Decimal.min(loss, cap);
      ordinaryOffset = useOrdinary;
      const remaining = loss.minus(useOrdinary);
      carryover = carryIn.plus(remaining);
      total = new Decimal(0);
    }

    // NIIT — applied only to positive net investment income above threshold.
    const niitThreshold = NIIT_THRESHOLD[input.filingStatus] ?? 200_000;
    const excessMagi = Math.max(0, input.magi - niitThreshold);
    const nii = Decimal.max(0, total);
    const niitBase = Decimal.min(nii, excessMagi);
    const niit = niitBase.times(0.038).toDecimalPlaces(2);

    return {
      perLot,
      netShortTermGain: netShort.toNumber(),
      netLongTermGain: netLong.toNumber(),
      totalCapitalGain: total.toNumber(),
      ordinaryLossOffset: ordinaryOffset.toNumber(),
      carryoverToNextYear: carryover.toNumber(),
      netInvestmentIncomeTax: niit.toNumber(),
      niitThresholdApplied: niitThreshold,
      notes,
    };
  },
  narrate(input, output) {
    return (
      `Capital gains for ${input.taxYear}: net short-term $${output.netShortTermGain.toLocaleString("en-US")}, ` +
      `net long-term $${output.netLongTermGain.toLocaleString("en-US")}, ` +
      `total taxable $${output.totalCapitalGain.toLocaleString("en-US")}. ` +
      `Carryover to next year: $${output.carryoverToNextYear.toLocaleString("en-US")}. ` +
      `NIIT (3.8%): $${output.netInvestmentIncomeTax.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(capitalGains);

export { capitalGains };
