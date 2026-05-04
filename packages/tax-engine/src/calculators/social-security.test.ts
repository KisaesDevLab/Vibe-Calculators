import { describe, expect, it } from "vitest";
import { socialSecurity } from "./social-security.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Social Security claiming-age optimizer", () => {
  it("2024 PIA from AIME $5,000 → 90% × 1,174 + 32% × 3,826 = 1,056.60 + 1,224.32 = $2,280.92", () => {
    const out = socialSecurity.compute(
      {
        aime: 5_000,
        birthYear: 1962,
        eligibilityYear: 2024,
        claimAgeYears: 67,
        comparisonClaimAge: 70,
      },
      ctx,
    );
    expect(out.pia).toBeCloseTo(2_280.92, 1);
  });

  it("Born 1960+: FRA is 67", () => {
    const out = socialSecurity.compute(
      {
        aime: 4_000,
        birthYear: 1962,
        eligibilityYear: 2024,
        claimAgeYears: 67,
      },
      ctx,
    );
    expect(out.fraYears).toBe(67);
    expect(out.fraMonths).toBe(0);
    // Claiming at FRA = full PIA
    expect(out.monthlyBenefitAtClaim).toBe(out.pia);
  });

  it("Claiming at 62 (5 years early for 1962 birth): 30% reduction", () => {
    const out = socialSecurity.compute(
      {
        aime: 4_000,
        birthYear: 1962,
        eligibilityYear: 2024,
        claimAgeYears: 62,
      },
      ctx,
    );
    // 36 months × 5/9% = 20% + 24 months × 5/12% = 10% → 30%
    expect(out.reductionOrCreditPct).toBeCloseTo(-0.3, 4);
    expect(out.monthlyBenefitAtClaim).toBeCloseTo(out.pia * 0.7, 1);
  });

  it("Claiming at 70 (3 years past FRA): +24% delayed retirement credit", () => {
    const out = socialSecurity.compute(
      {
        aime: 4_000,
        birthYear: 1962,
        eligibilityYear: 2024,
        claimAgeYears: 70,
      },
      ctx,
    );
    // 36 months × 8/12% = 24%
    expect(out.reductionOrCreditPct).toBeCloseTo(0.24, 4);
    expect(out.monthlyBenefitAtClaim).toBeCloseTo(out.pia * 1.24, 1);
  });

  it("Break-even age between 62 and 67 lands ~78-80 for typical PIA", () => {
    const out = socialSecurity.compute(
      {
        aime: 4_000,
        birthYear: 1962,
        eligibilityYear: 2024,
        claimAgeYears: 62,
        comparisonClaimAge: 67,
      },
      ctx,
    );
    expect(out.breakEvenAge).toBeGreaterThan(76);
    expect(out.breakEvenAge).toBeLessThan(82);
  });
});
