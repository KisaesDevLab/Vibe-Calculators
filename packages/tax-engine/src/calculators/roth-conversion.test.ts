import { describe, expect, it } from "vitest";
import { rothConversion } from "./roth-conversion.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Roth conversion analyzer", () => {
  it("$50k conversion at the 22% bracket cliff — tax cost matches bracket math", () => {
    // Single, 2024, pre-conversion taxable $80,000.
    // $80k → $130k crosses the 22%/24% boundary at $100,525.
    // Tax bump: ($100,525 - $80,000) × 22% + ($130,000 - $100,525) × 24% = $4,515.50 + $7,074.00 = $11,589.50
    const out = rothConversion.compute(
      {
        conversionAmount: 50_000,
        preConversionTaxableIncome: 80_000,
        preConversionMagi: 100_000,
        filingStatus: "single",
        taxYear: 2024,
        currentAge: 50,
        retirementAge: 65,
        growthRate: 0.07,
        retirementMarginalRate: 0.22,
      },
      ctx,
    );
    expect(out.conversionTaxCost).toBeCloseTo(11589.5, 0);
    // effective rate = 11,589.50 / 50,000 = ~23.18%
    expect(out.effectiveConversionRate).toBeCloseTo(0.2318, 3);
    expect(out.marginalRateAtTopOfConversion).toBe(0.24);
  });

  it("FV after 15 yrs at 7%: convert path > no-convert when retire-rate >= eff-rate", () => {
    const out = rothConversion.compute(
      {
        conversionAmount: 100_000,
        preConversionTaxableIncome: 50_000,
        preConversionMagi: 60_000,
        filingStatus: "single",
        taxYear: 2024,
        currentAge: 50,
        retirementAge: 65,
        growthRate: 0.07,
        retirementMarginalRate: 0.24,
      },
      ctx,
    );
    expect(out.futureValueRothConverted).toBeGreaterThan(out.futureValueNoConvertAfterTax);
    expect(out.breakEvenAge).toBe(50);
  });

  it("Detects IRMAA threshold crossing for single $90k → $130k MAGI", () => {
    const out = rothConversion.compute(
      {
        conversionAmount: 40_000,
        preConversionTaxableIncome: 80_000,
        preConversionMagi: 90_000,
        filingStatus: "single",
        taxYear: 2024,
        currentAge: 50,
        retirementAge: 65,
        growthRate: 0.07,
        retirementMarginalRate: 0.22,
      },
      ctx,
    );
    expect(out.irmaaThresholdCrossed).toBe(true);
  });
});
