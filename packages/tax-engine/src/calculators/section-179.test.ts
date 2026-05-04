import { describe, expect, it } from "vitest";
import { section179 } from "./section-179.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Section 179 — Pub 946 ch. 2", () => {
  it("2024: $500k qualifying purchase, ample income → fully deductible (under limit)", () => {
    const out = section179.compute(
      {
        totalQualifyingCost: 500000,
        heavySuvCost: 0,
        aggregateBusinessIncome: 1_000_000,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.statutoryLimit).toBe(1_160_000);
    expect(out.effectiveLimitAfterPhaseout).toBe(1_160_000);
    expect(out.totalSection179).toBe(500000);
    expect(out.allowedThisYear).toBe(500000);
    expect(out.carryforward).toBe(0);
  });

  it("2024: phase-out kicks in dollar-for-dollar above $2,890,000", () => {
    // $3,000,000 of property = $110,000 over phaseoutStart → limit reduced to 1,160,000 - 110,000 = 1,050,000
    const out = section179.compute(
      {
        totalQualifyingCost: 3_000_000,
        heavySuvCost: 0,
        aggregateBusinessIncome: 5_000_000,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.effectiveLimitAfterPhaseout).toBe(1_050_000);
    expect(out.totalSection179).toBe(1_050_000);
  });

  it("2024: phase-out fully zeros §179 above $4,050,000 of qualifying property", () => {
    const out = section179.compute(
      {
        totalQualifyingCost: 4_100_000,
        heavySuvCost: 0,
        aggregateBusinessIncome: 5_000_000,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.effectiveLimitAfterPhaseout).toBe(0);
    expect(out.totalSection179).toBe(0);
  });

  it("2025: SUV cap clamps an $80k SUV to $31,300", () => {
    const out = section179.compute(
      {
        totalQualifyingCost: 80000,
        heavySuvCost: 80000,
        aggregateBusinessIncome: 500000,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.suvCap).toBe(31_300);
    expect(out.suvSection179).toBe(31_300);
    expect(out.nonSuvSection179).toBe(0);
    expect(out.totalSection179).toBe(31_300);
  });

  it("2024: business-income limit creates a carryforward", () => {
    // Elect $1,000,000; business income only $400,000 → carry forward $600,000.
    const out = section179.compute(
      {
        totalQualifyingCost: 1_000_000,
        heavySuvCost: 0,
        aggregateBusinessIncome: 400_000,
        filingStatus: "mfj",
        mfsAllocation: 0.5,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.totalSection179).toBe(1_000_000);
    expect(out.allowedThisYear).toBe(400_000);
    expect(out.carryforward).toBe(600_000);
  });

  it("2024: MFS with 60/40 allocation halves and re-allocates the limit", () => {
    const out = section179.compute(
      {
        totalQualifyingCost: 1_500_000,
        heavySuvCost: 0,
        aggregateBusinessIncome: 5_000_000,
        filingStatus: "mfs",
        mfsAllocation: 0.6,
        taxYear: 2024,
      },
      ctx,
    );
    // Statutory limit 1,160,000 × 0.6 = 696,000 (no phaseout, totalQualifyingCost < 2.89M)
    expect(out.effectiveLimitAfterMfs).toBe(696_000);
    expect(out.totalSection179).toBe(696_000);
  });
});
