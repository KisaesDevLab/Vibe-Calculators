import { describe, expect, it } from "vitest";
import { stateTax } from "./state-tax.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("State income-tax quick estimator", () => {
  it("Florida: no income tax, returns 0", () => {
    const out = stateTax.compute(
      {
        state: "FL",
        federalAgi: 200_000,
        personalExemptions: 0,
        filingStatus: "single",
        additionalSubtractions: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.hasIncomeTax).toBe(false);
    expect(out.stateIncomeTax).toBe(0);
  });

  it("Pennsylvania flat 3.07%: $100k AGI → $3,070", () => {
    const out = stateTax.compute(
      {
        state: "PA",
        federalAgi: 100_000,
        personalExemptions: 0,
        filingStatus: "single",
        additionalSubtractions: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.stateIncomeTax).toBeCloseTo(3070, 0);
    expect(out.effectiveStateRate).toBeCloseTo(0.0307, 4);
  });

  it("Illinois flat 4.95%: $100k AGI → $4,950", () => {
    const out = stateTax.compute(
      {
        state: "IL",
        federalAgi: 100_000,
        personalExemptions: 0,
        filingStatus: "single",
        additionalSubtractions: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.stateIncomeTax).toBeCloseTo(4950, 0);
  });

  it("Missouri progressive: $50k AGI single, std deduction $14,600 → tax on $35,400", () => {
    const out = stateTax.compute(
      {
        state: "MO",
        federalAgi: 50_000,
        personalExemptions: 0,
        filingStatus: "single",
        additionalSubtractions: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.standardDeductionApplied).toBe(14_600);
    expect(out.stateTaxableIncome).toBe(35_400);
    // Tax > 0 and well under top rate × 35,400 = 1,663.80
    expect(out.stateIncomeTax).toBeGreaterThan(0);
    expect(out.stateIncomeTax).toBeLessThan(1700);
  });

  it("California top bracket: $1M AGI hits 9.3% range", () => {
    const out = stateTax.compute(
      {
        state: "CA",
        federalAgi: 1_000_000,
        personalExemptions: 0,
        filingStatus: "single",
        additionalSubtractions: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.stateIncomeTax).toBeGreaterThan(80_000);
    expect(out.effectiveStateRate).toBeGreaterThan(0.08);
  });

  it("Surfaces the not-a-substitute disclaimer in notes", () => {
    const out = stateTax.compute(
      {
        state: "MO",
        federalAgi: 50_000,
        personalExemptions: 0,
        filingStatus: "single",
        additionalSubtractions: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.notes[0]).toContain("Approximation");
  });
});
