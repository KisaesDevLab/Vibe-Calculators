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
    /**
     * Mortgage on the property assumed by the buyer. Per §453(c) and
     * Pub 537, the contract price = sale price − (qualifying indebtedness
     * assumed up to the seller's adjusted basis). Pass 0 (default) when
     * no debt is assumed.
     */
    mortgageAssumedByBuyer: z.number().nonnegative().finite().default(0),
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
    // Pub 537 / Form 6252:
    //   Gross profit       = sale price - adjusted basis - selling expenses
    //   Contract price     = sale price - (mortgage assumed up to basis)
    //   §1245/§1250 recapture is recognized in year of sale and is NOT
    //   re-applied to subsequent installments. Per Pub 537 example,
    //   gross profit for the GPR drops by the recapture amount so the
    //   per-installment gain accounts only for §1250-unrecaptured.
    const recapture = new Decimal(input.depreciationRecapture);
    const grossProfitBeforeRecapture = new Decimal(input.salePrice)
      .minus(input.adjustedBasis)
      .minus(input.sellingExpenses);
    const grossProfitForGpr = Decimal.max(0, grossProfitBeforeRecapture.minus(recapture));
    // Per Pub 537: mortgage assumed up to adjusted basis reduces
    // contract price. Excess over basis is treated as a year-1
    // "deemed payment" — it cannot be deferred via installment.
    const mortgageAssumed = new Decimal(input.mortgageAssumedByBuyer ?? 0);
    const debtAssumedReducingContract = Decimal.min(mortgageAssumed, input.adjustedBasis);
    const debtExcessOverBasis = Decimal.max(0, mortgageAssumed.minus(input.adjustedBasis));
    const contractPrice = Decimal.max(
      new Decimal(0.01),
      new Decimal(input.salePrice).minus(debtAssumedReducingContract),
    );
    const gpr = grossProfitForGpr.div(contractPrice);

    const schedule: Output["schedule"] = [];
    let total = new Decimal(0);

    for (let i = 0; i < input.payments.length; i++) {
      const p = input.payments[i];
      if (!p) continue;
      // Year-1 deemed payment: mortgage excess over basis is treated as
      // additional year-1 principal received (Pub 537). Add before
      // multiplying by GPR.
      const deemedThisYear = i === 0 ? debtExcessOverBasis : new Decimal(0);
      const principal = new Decimal(p.principal).plus(deemedThisYear);
      const installmentGain = principal.times(gpr).toDecimalPlaces(2);
      // Recapture: recognized once in year of sale (i=0 only); not
      // re-applied — gpr already excludes it from the per-installment math.
      const recaptureThis = i === 0 ? recapture : new Decimal(0);
      schedule.push({
        year: p.year,
        principalReceived: principal.toNumber(),
        interestIncome: p.interest,
        gainRecognized: installmentGain.toNumber(),
        ordinaryRecapture: recaptureThis.toNumber(),
      });
      total = total.plus(installmentGain).plus(recaptureThis);
    }
    const grossProfit = grossProfitBeforeRecapture;

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
