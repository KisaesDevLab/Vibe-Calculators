import { describe, expect, it } from "vitest";
import { hsa } from "./hsa.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("HSA contribution & projection", () => {
  it("2024 self-only, 12 months eligible, age 40: limit $4,150", () => {
    const out = hsa.compute(
      {
        coverage: "self_only",
        age: 40,
        monthsEligible: 12,
        plannedContribution: 4_150,
        useLastMonthRule: false,
        taxYear: 2024,
        currentBalance: 0,
        yearsToProject: 0,
        growthRate: 0.06,
      },
      ctx,
    );
    expect(out.baseLimit).toBe(4_150);
    expect(out.finalLimit).toBe(4_150);
    expect(out.contributionRoom).toBe(0);
  });

  it("2024 family, age 55: $8,300 + $1,000 catch-up = $9,300", () => {
    const out = hsa.compute(
      {
        coverage: "family",
        age: 55,
        monthsEligible: 12,
        plannedContribution: 0,
        useLastMonthRule: false,
        taxYear: 2024,
        currentBalance: 0,
        yearsToProject: 0,
        growthRate: 0.06,
      },
      ctx,
    );
    expect(out.catchupAllowed).toBe(1_000);
    expect(out.finalLimit).toBe(9_300);
  });

  it("Pro-ration: 6 months eligible → half the annual limit", () => {
    const out = hsa.compute(
      {
        coverage: "self_only",
        age: 40,
        monthsEligible: 6,
        plannedContribution: 0,
        useLastMonthRule: false,
        taxYear: 2024,
        currentBalance: 0,
        yearsToProject: 0,
        growthRate: 0.06,
      },
      ctx,
    );
    expect(out.finalLimit).toBe(2_075);
  });

  it("Last-month rule overrides pro-ration → full limit", () => {
    const out = hsa.compute(
      {
        coverage: "self_only",
        age: 40,
        monthsEligible: 1,
        plannedContribution: 0,
        useLastMonthRule: true,
        taxYear: 2024,
        currentBalance: 0,
        yearsToProject: 0,
        growthRate: 0.06,
      },
      ctx,
    );
    expect(out.finalLimit).toBe(4_150);
    expect(out.notes.some((n) => n.includes("Last-month"))).toBe(true);
  });

  it("Projection: $5k initial + $4,150 annual contrib over 30 yrs at 6% ≈ $376k", () => {
    const out = hsa.compute(
      {
        coverage: "self_only",
        age: 40,
        monthsEligible: 12,
        plannedContribution: 4_150,
        useLastMonthRule: false,
        taxYear: 2024,
        currentBalance: 5_000,
        yearsToProject: 30,
        growthRate: 0.06,
      },
      ctx,
    );
    // Annuity-due: 5000 × 1.06^30 + 4150 × ((1.06^30 - 1)/0.06) × 1.06
    //            = 28,717 + 347,778 = 376,495
    expect(out.projectedBalance).toBeGreaterThan(376_000);
    expect(out.projectedBalance).toBeLessThan(377_000);
  });

  it("Projection at 0% growth degenerates to balance + n × annual contribution", () => {
    const out = hsa.compute(
      {
        coverage: "self_only",
        age: 40,
        monthsEligible: 12,
        plannedContribution: 4_150,
        useLastMonthRule: false,
        taxYear: 2024,
        currentBalance: 5_000,
        yearsToProject: 10,
        growthRate: 0,
      },
      ctx,
    );
    expect(out.projectedBalance).toBe(5_000 + 10 * 4_150);
  });
});
