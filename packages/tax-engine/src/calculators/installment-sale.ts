import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 19.3 — Installment sale under IRC §453.
 *
 * Gross profit ratio:
 *   GPR = gross profit / total contract price
 *   where gross profit = sale price - adjusted basis - selling expenses
 *
 * For each year, gain recognized = principal received × GPR.
 * Interest is reported separately as ordinary income.
 *
 * Depreciation recapture under §1245/§1250 is recognized in year of
 * sale, regardless of payment schedule.
 */

const paymentSchema = z.object({
  year: z.number().int().min(1900).max(2100),
  principal: z.number().nonnegative().finite(),
  interest: z.number().nonnegative().finite().default(0),
});

const inputSchema = z
  .object({
    salePrice: z.number().positive().finite(),
    adjustedBasis: z.number().nonnegative().finite(),
    sellingExpenses: z.number().nonnegative().finite().default(0),
    /** Depreciation recapture recognized in year of sale (§1245/§1250). */
    depreciationRecapture: z.number().nonnegative().finite().default(0),
    /** Year-by-year principal + interest collected. */
    payments: z.array(paymentSchema).min(1),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const yearRowSchema = z.object({
  year: z.number().int(),
  principalReceived: z.number(),
  interestIncome: z.number(),
  gainRecognized: z.number(),
  ordinaryRecapture: z.number(),
});

const outputSchema = z.object({
  grossProfit: z.number(),
  contractPrice: z.number(),
  grossProfitRatio: z.number(),
  schedule: z.array(yearRowSchema),
  totalGainOverLife: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const installmentSale: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.installment_sale",
    name: "Installment sale (§453)",
    description:
      "§453 installment-method gain reporting: gross-profit ratio applied to principal each year; recapture in year of sale.",
    taxYears: [2024, 2025],
    formReferences: ["Form 6252", "Pub 537"],
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
    const grossProfit = new Decimal(input.salePrice)
      .minus(input.adjustedBasis)
      .minus(input.sellingExpenses);
    const contractPrice = new Decimal(input.salePrice);
    const gpr = grossProfit.div(contractPrice);

    const schedule: Output["schedule"] = [];
    const recapture = new Decimal(input.depreciationRecapture);
    let recaptureRemaining = recapture;
    let total = new Decimal(0);

    for (let i = 0; i < input.payments.length; i++) {
      const p = input.payments[i];
      if (!p) continue;
      const principal = new Decimal(p.principal);
      const installmentGain = principal.times(gpr).toDecimalPlaces(2);
      // Recapture: recognized in year of sale (year 0 = first payment year).
      const recaptureThis = i === 0 ? recapture : new Decimal(0);
      recaptureRemaining = recaptureRemaining.minus(recaptureThis);
      schedule.push({
        year: p.year,
        principalReceived: principal.toNumber(),
        interestIncome: p.interest,
        gainRecognized: installmentGain.toNumber(),
        ordinaryRecapture: recaptureThis.toNumber(),
      });
      total = total.plus(installmentGain).plus(recaptureThis);
    }

    const notes: string[] = [];
    if (recapture.gt(0)) {
      notes.push(
        `§1245/§1250 recapture of $${recapture.toString()} recognized in year of sale, regardless of payment schedule.`,
      );
    }
    if (gpr.gt(1)) {
      notes.push(
        "Gross-profit ratio > 1.0 — check inputs (sale price < gross profit is inconsistent).",
      );
    }

    return {
      grossProfit: grossProfit.toDecimalPlaces(2).toNumber(),
      contractPrice: contractPrice.toNumber(),
      grossProfitRatio: gpr.toDecimalPlaces(6).toNumber(),
      schedule,
      totalGainOverLife: total.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `Installment sale: $${input.salePrice.toLocaleString("en-US")} sale, ` +
      `gross profit $${output.grossProfit.toLocaleString("en-US")}, ` +
      `GPR ${(output.grossProfitRatio * 100).toFixed(2)}%, ` +
      `gain recognized over ${input.payments.length} years totaling $${output.totalGainOverLife.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(installmentSale);

export { installmentSale };
