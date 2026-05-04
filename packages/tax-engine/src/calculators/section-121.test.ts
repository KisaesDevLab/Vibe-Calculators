import { describe, expect, it } from "vitest";
import { section121 } from "./section-121.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("§121 home-sale exclusion", () => {
  it("Single full $250k exclusion: $300k gain → $50k taxable", () => {
    const out = section121.compute(
      {
        salePrice: 800_000,
        adjustedBasis: 500_000,
        sellingExpenses: 0,
        filingStatus: "single",
        monthsOwned: 60,
        monthsUsed: 60,
        usedExclusionInLast24Months: false,
        monthsNonqualifiedUse: 0,
        totalMonthsOwned: 60,
        partialExclusionReason: "none",
        partialMonthsCount: 0,
      },
      ctx,
    );
    expect(out.realizedGain).toBe(300_000);
    expect(out.exclusionAvailable).toBe(250_000);
    expect(out.taxableGain).toBe(50_000);
  });

  it("MFJ full $500k exclusion: $400k gain → $0 taxable", () => {
    const out = section121.compute(
      {
        salePrice: 1_000_000,
        adjustedBasis: 600_000,
        sellingExpenses: 0,
        filingStatus: "mfj",
        monthsOwned: 60,
        monthsUsed: 60,
        usedExclusionInLast24Months: false,
        monthsNonqualifiedUse: 0,
        totalMonthsOwned: 60,
        partialExclusionReason: "none",
        partialMonthsCount: 0,
      },
      ctx,
    );
    expect(out.exclusionAvailable).toBe(500_000);
    expect(out.taxableGain).toBe(0);
  });

  it("Failed test + work-related partial: 12 months → 50% × $250k = $125k", () => {
    const out = section121.compute(
      {
        salePrice: 600_000,
        adjustedBasis: 400_000,
        sellingExpenses: 0,
        filingStatus: "single",
        monthsOwned: 18, // < 24 → fail
        monthsUsed: 18,
        usedExclusionInLast24Months: false,
        monthsNonqualifiedUse: 0,
        totalMonthsOwned: 18,
        partialExclusionReason: "work",
        partialMonthsCount: 12,
      },
      ctx,
    );
    expect(out.exclusionAvailable).toBe(125_000);
    expect(out.taxableGain).toBe(75_000);
  });

  it("Nonqualified-use ratio reduces exclusion", () => {
    // 24 months nonqualified use out of 60 total → 40% reduction.
    const out = section121.compute(
      {
        salePrice: 800_000,
        adjustedBasis: 500_000,
        sellingExpenses: 0,
        filingStatus: "single",
        monthsOwned: 60,
        monthsUsed: 60,
        usedExclusionInLast24Months: false,
        monthsNonqualifiedUse: 24,
        totalMonthsOwned: 60,
        partialExclusionReason: "none",
        partialMonthsCount: 0,
      },
      ctx,
    );
    // 250k × (1 - 0.4) = 150k
    expect(out.exclusionAvailable).toBe(150_000);
    expect(out.taxableGain).toBe(150_000);
  });
});
