import { describe, expect, it } from "vitest";
import { macrs } from "./macrs.js";
import { runFixtures } from "../fixture-runner.js";

/**
 * Phase 16.1 fixtures — IRS Pub 946 Appendix A worked examples.
 *
 * Each fixture verifies the year-by-year depreciation amount for a
 * canonical scenario. Tolerance is $1 per the build-plan spec.
 */

describe("MACRS — IRS Pub 946 Appendix A", () => {
  // 5-year, half-year, $10,000 basis (Pub 946 Table A-1).
  // Expected: $2,000 / $3,200 / $1,920 / $1,152 / $1,152 / $576
  it("5-year half-year on $10,000 = published table percentages", () => {
    const out = macrs.compute(
      {
        basis: 10000,
        propertyClass: "5",
        placedInServiceYear: 2024,
        useAds: false,
      },
      { tables: new Map(), asOf: new Date() },
    );
    expect(out.method).toBe("GDS-half-year");
    expect(out.schedule.length).toBe(6);
    expect(out.schedule[0]?.depreciation).toBe(2000);
    expect(out.schedule[1]?.depreciation).toBe(3200);
    expect(out.schedule[2]?.depreciation).toBe(1920);
    expect(out.schedule[3]?.depreciation).toBe(1152);
    expect(out.schedule[4]?.depreciation).toBe(1152);
    expect(out.schedule[5]?.depreciation).toBe(576);
    expect(out.totalDepreciation).toBe(10000);
  });

  // 7-year, half-year, $14,000 (Pub 946 Table A-1 example).
  // Year 1: 14.29% × 14000 = 2000.60 ≈ $2,001
  it("7-year half-year on $14,000 sums to basis exactly", () => {
    const out = macrs.compute(
      {
        basis: 14000,
        propertyClass: "7",
        placedInServiceYear: 2024,
        useAds: false,
      },
      { tables: new Map(), asOf: new Date() },
    );
    expect(out.schedule.length).toBe(8);
    expect(out.totalDepreciation).toBe(14000);
    // Last row's accumulated depreciation pinned to basis.
    const last = out.schedule[out.schedule.length - 1];
    expect(last?.accumulatedDepreciation).toBe(14000);
    expect(last?.endOfYearBasis).toBe(0);
  });

  // 27.5-year residential rental, mid-month, placed in service June.
  // Pub 946 Table A-6, month 6: year-1 = 1.970%
  it("27.5-year residential rental placed in June applies the mid-month June percentage", () => {
    const basis = 200000;
    const out = macrs.compute(
      {
        basis,
        propertyClass: "27.5",
        placedInServiceYear: 2024,
        placedInServiceMonth: 6,
        useAds: false,
      },
      { tables: new Map(), asOf: new Date() },
    );
    expect(out.method).toBe("GDS-mid-month");
    expect(out.schedule[0]?.percentage).toBeCloseTo(1.97, 5);
    // 1.970% × 200,000 = 3,940
    expect(out.schedule[0]?.depreciation).toBe(3940);
    // Schedule sums to basis
    expect(out.totalDepreciation).toBe(basis);
  });

  // 39-year nonresidential real, mid-month, placed in service January.
  // Pub 946 Table A-7a, month 1: year-1 = 2.461%
  it("39-year nonresidential real placed in January", () => {
    const out = macrs.compute(
      {
        basis: 1_000_000,
        propertyClass: "39",
        placedInServiceYear: 2024,
        placedInServiceMonth: 1,
        useAds: false,
      },
      { tables: new Map(), asOf: new Date() },
    );
    expect(out.schedule[0]?.percentage).toBeCloseTo(2.461, 5);
    expect(out.schedule[0]?.depreciation).toBe(24610);
    expect(out.totalDepreciation).toBe(1_000_000);
  });

  // ADS straight-line, 10-year life, $50,000.
  // Year 1 = 5%, Years 2..10 = 10%, Year 11 = 5%. Sum = 100%.
  it("ADS straight-line over 10 years on $50,000", () => {
    const out = macrs.compute(
      {
        basis: 50000,
        propertyClass: "5",
        placedInServiceYear: 2024,
        useAds: true,
        adsLifeYears: 10,
      },
      { tables: new Map(), asOf: new Date() },
    );
    expect(out.method).toBe("ADS-straight-line");
    expect(out.schedule[0]?.depreciation).toBe(2500);
    expect(out.schedule[1]?.depreciation).toBe(5000);
    expect(out.schedule[10]?.depreciation).toBe(2500);
    expect(out.totalDepreciation).toBe(50000);
  });
});

describe("MACRS — fixture runner", () => {
  runFixtures(macrs, [
    {
      name: "Pub 946 ex. 5y half-year — $10,000 basis",
      taxYear: 2024,
      input: {
        basis: 10000,
        propertyClass: "5" as const,
        placedInServiceYear: 2024,
        useAds: false,
      },
      expectedOutput: { totalDepreciation: 10000 },
      source: "IRS Pub 946 Appendix A Table A-1",
    },
    {
      name: "20-year half-year — $20,000",
      taxYear: 2024,
      input: {
        basis: 20000,
        propertyClass: "20" as const,
        placedInServiceYear: 2024,
        useAds: false,
      },
      expectedOutput: { totalDepreciation: 20000 },
      source: "IRS Pub 946 Appendix A Table A-1",
    },
  ]);
});
