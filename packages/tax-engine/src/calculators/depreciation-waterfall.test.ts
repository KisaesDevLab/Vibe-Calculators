import { describe, expect, it } from "vitest";
import { waterfall } from "./depreciation-waterfall.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Depreciation waterfall — 179 → bonus → MACRS ordering", () => {
  it("2024: $200k 5-year asset, full §179 election, then 60% bonus on remainder, then MACRS", () => {
    const out = waterfall.compute(
      {
        cost: 200000,
        propertyClass: "5",
        placedInServiceDate: "2024-06-15",
        aggregateBusinessIncome: 5_000_000,
        taxYear: 2024,
        heavySuvCost: 0,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        electOutOfBonus: false,
        useAds: false,
      },
      ctx,
    );
    // §179: $200k taken (well under $1.16M limit)
    expect(out.allowedSection179).toBe(200000);
    // After §179, basis = 0 → no bonus, no MACRS
    expect(out.bonusDepreciation).toBe(0);
    expect(out.basisAfter179AndBonus).toBe(0);
    expect(out.totalYearOneDeduction).toBe(200000);
  });

  it("2024: $5M asset (above §179 phase-out) → all bonus + MACRS", () => {
    // §179 phased out completely. Bonus 60% on $5M = $3M. MACRS on $2M.
    const out = waterfall.compute(
      {
        cost: 5_000_000,
        propertyClass: "7",
        placedInServiceDate: "2024-06-15",
        aggregateBusinessIncome: 10_000_000,
        taxYear: 2024,
        heavySuvCost: 0,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        electOutOfBonus: false,
        useAds: false,
      },
      ctx,
    );
    expect(out.allowedSection179).toBe(0);
    expect(out.bonusDepreciation).toBe(3_000_000);
    expect(out.basisAfter179AndBonus).toBe(2_000_000);
    // 7-year half-year year-1 = 14.29% of $2M = $285,800
    const macrsYear1 = out.consolidatedSchedule.find(
      (r) => r.bucket === "macrs" && r.year === 2024,
    );
    expect(macrsYear1?.amount).toBeCloseTo(285800, 0);
  });

  it("OBBBA: $1M class-5 asset placed 2025-02-01 → §179 first, then 100% bonus on remainder", () => {
    const out = waterfall.compute(
      {
        cost: 1_000_000,
        propertyClass: "5",
        placedInServiceDate: "2025-02-01",
        aggregateBusinessIncome: 5_000_000,
        taxYear: 2025,
        heavySuvCost: 0,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        electOutOfBonus: false,
        useAds: false,
      },
      ctx,
    );
    // §179 takes $1M (well under $1.25M limit). Nothing left for bonus.
    expect(out.allowedSection179).toBe(1_000_000);
    expect(out.bonusDepreciation).toBe(0);
  });

  it("Elected §179 < max possible flows the difference to bonus", () => {
    const out = waterfall.compute(
      {
        cost: 1_000_000,
        propertyClass: "5",
        placedInServiceDate: "2025-02-01",
        aggregateBusinessIncome: 5_000_000,
        taxYear: 2025,
        electedSection179: 500_000,
        heavySuvCost: 0,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        electOutOfBonus: false,
        useAds: false,
      },
      ctx,
    );
    expect(out.allowedSection179).toBe(500_000);
    expect(out.bonusPctApplied).toBe(1.0);
    expect(out.bonusDepreciation).toBe(500_000);
    expect(out.basisAfter179AndBonus).toBe(0);
  });
});
