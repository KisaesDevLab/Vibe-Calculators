import { describe, expect, it } from "vitest";
import { annualization } from "./annualization.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Annualization", () => {
  it("Mid-year biweekly: $26k YTD on day 182 → ~13 periods completed → ~$52k full year", () => {
    const out = annualization.compute(
      {
        ytdAmount: 26_000,
        asOfDate: "2025-07-01", // day 182
        cadence: "biweekly",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.asOfDayOfYear).toBeGreaterThanOrEqual(180);
    expect(out.asOfDayOfYear).toBeLessThanOrEqual(184);
    expect(out.periodsCompleted).toBeCloseTo(13, 0);
    expect(out.projectedFullYear).toBeCloseTo(52_000, -2);
  });

  it("Year-end weekly: $52k YTD on day 365 → 52 periods completed → $52k projection", () => {
    const out = annualization.compute(
      {
        ytdAmount: 52_000,
        asOfDate: "2025-12-31",
        cadence: "weekly",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.periodsCompleted).toBe(52);
    expect(out.periodsRemaining).toBe(0);
    expect(out.projectedFullYear).toBe(52_000);
  });

  it("Quarterly snapshot: $30k YTD on day 90 monthly → $30k → 3 periods → $120k full year", () => {
    const out = annualization.compute(
      {
        ytdAmount: 30_000,
        asOfDate: "2025-03-31",
        cadence: "monthly",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.periodsCompleted).toBe(3);
    expect(out.perPeriodAverage).toBe(10_000);
    expect(out.projectedFullYear).toBe(120_000);
  });
});
