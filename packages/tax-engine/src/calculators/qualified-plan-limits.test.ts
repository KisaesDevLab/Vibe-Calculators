import { describe, expect, it } from "vitest";
import { qualifiedPlanLimits } from "./qualified-plan-limits.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Qualified-plan contribution limits", () => {
  it("2024 401(k) age 35: $23,000 employee, $69k §415(c) cap", () => {
    const out = qualifiedPlanLimits.compute(
      {
        planType: "401k",
        age: 35,
        compensation: 200_000,
        employeeDeferralPlanned: 23_000,
        employerContributionPlanned: 20_000,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.employeeLimit).toBe(23_000);
    expect(out.combinedLimit).toBe(69_000);
    expect(out.catchupApplied).toBe(0);
  });

  it("2024 401(k) age 55: includes $7,500 catch-up → combined $76,500", () => {
    const out = qualifiedPlanLimits.compute(
      {
        planType: "401k",
        age: 55,
        compensation: 200_000,
        employeeDeferralPlanned: 0,
        employerContributionPlanned: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.catchupApplied).toBe(7_500);
    expect(out.combinedLimit).toBe(76_500);
  });

  it("2025 401(k) age 62: SECURE 2.0 enhanced catch-up $11,250", () => {
    const out = qualifiedPlanLimits.compute(
      {
        planType: "401k",
        age: 62,
        compensation: 200_000,
        employeeDeferralPlanned: 0,
        employerContributionPlanned: 0,
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.catchupApplied).toBe(11_250);
  });

  it("SEP IRA: 25% × $200k = $50k, capped at annual $69,000", () => {
    const out = qualifiedPlanLimits.compute(
      {
        planType: "sep_ira",
        age: 40,
        compensation: 200_000,
        employeeDeferralPlanned: 0,
        employerContributionPlanned: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.employerLimit).toBe(50_000);
  });

  it("SEP IRA hits $69k cap at $276k+ comp", () => {
    const out = qualifiedPlanLimits.compute(
      {
        planType: "sep_ira",
        age: 40,
        compensation: 500_000,
        employeeDeferralPlanned: 0,
        employerContributionPlanned: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.employerLimit).toBe(69_000);
  });

  it("SIMPLE IRA: $16,000 employee 2024 + $3,500 catch-up + 3% match", () => {
    const out = qualifiedPlanLimits.compute(
      {
        planType: "simple_ira",
        age: 55,
        compensation: 100_000,
        employeeDeferralPlanned: 0,
        employerContributionPlanned: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.employeeLimit).toBe(16_000);
    expect(out.catchupApplied).toBe(3_500);
    expect(out.employerLimit).toBe(3_000); // 3% of 100k
  });
});
