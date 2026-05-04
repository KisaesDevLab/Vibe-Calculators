import { describe, expect, it } from "vitest";
import { costSegregation } from "./cost-segregation.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Cost-segregation impact estimator", () => {
  it("Simple split: $1M building → $200k 5-year + $800k 39-year", () => {
    const out = costSegregation.compute(
      {
        totalBasis: 1_000_000,
        allocation5Year: 200_000,
        allocation7Year: 0,
        allocation15Year: 0,
        placedInServiceYear: 2024,
        placedInServiceMonth: 1,
        discountRate: 0.08,
      },
      ctx,
    );
    expect(out.buckets["5-year"]).toBe(200_000);
    expect(out.buckets["39-year"]).toBe(800_000);

    // Year-1 5-year half-year on $200k: 20% × 200,000 = $40,000
    // Year-1 39-year mid-month Jan on $800k: 2.461% × 800,000 = $19,688
    // Total cost-seg year-1: ~$59,688
    expect(out.yearOneWithCostSeg).toBeCloseTo(59_688, 0);

    // Without: 39-year mid-month Jan on full $1M = 2.461% × 1,000,000 = $24,610
    expect(out.yearOneWithoutCostSeg).toBeCloseTo(24_610, 0);

    expect(out.yearOneLift).toBeCloseTo(35_078, 0);
    // NPV lift should be positive — accelerating depreciation always wins at any positive discount rate
    expect(out.npvLift).toBeGreaterThan(0);
  });

  it("All-in-39 (no cost seg) yields zero lift and zero NPV difference", () => {
    const out = costSegregation.compute(
      {
        totalBasis: 1_000_000,
        allocation5Year: 0,
        allocation7Year: 0,
        allocation15Year: 0,
        placedInServiceYear: 2024,
        placedInServiceMonth: 1,
        discountRate: 0.08,
      },
      ctx,
    );
    expect(out.yearOneLift).toBeCloseTo(0, 0);
    expect(out.npvLift).toBeCloseTo(0, 0);
  });

  it("Allocation exceeding totalBasis fails validation", () => {
    const r = costSegregation.validateInputs({
      totalBasis: 1_000_000,
      allocation5Year: 600_000,
      allocation7Year: 600_000,
      allocation15Year: 0,
      placedInServiceYear: 2024,
      placedInServiceMonth: 1,
      discountRate: 0.08,
    });
    expect(r.ok).toBe(false);
  });
});
