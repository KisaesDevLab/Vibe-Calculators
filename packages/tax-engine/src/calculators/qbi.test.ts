import { describe, expect, it } from "vitest";
import { qbi } from "./qbi.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("QBI §199A — Form 8995/8995-A", () => {
  it("Below threshold (single, $100k QBI, $150k TI): simple 20%", () => {
    const out = qbi.compute(
      {
        qbiFromNonSstb: 100_000,
        qbiFromSstb: 0,
        w2WagesNonSstb: 0,
        ubiaNonSstb: 0,
        qualifiedReitPtpIncome: 0,
        taxableIncomeBeforeQbi: 150_000,
        netCapitalGain: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.regime).toBe("below");
    expect(out.componentNonSstb).toBe(20_000);
    expect(out.qbiDeduction).toBe(20_000);
  });

  it("Above threshold non-SSTB (single, $300k TI > $241,950 end), W-2 limit binds", () => {
    // Non-SSTB QBI $200,000, no W-2, no UBIA → W-2/UBIA limit = 0 → deduction = 0
    const out = qbi.compute(
      {
        qbiFromNonSstb: 200_000,
        qbiFromSstb: 0,
        w2WagesNonSstb: 0,
        ubiaNonSstb: 0,
        qualifiedReitPtpIncome: 0,
        taxableIncomeBeforeQbi: 300_000,
        netCapitalGain: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.regime).toBe("above");
    expect(out.componentNonSstb).toBe(0);
    expect(out.qbiDeduction).toBe(0);
  });

  it("Above threshold SSTB → SSTB QBI excluded entirely", () => {
    const out = qbi.compute(
      {
        qbiFromNonSstb: 0,
        qbiFromSstb: 200_000,
        w2WagesNonSstb: 100_000,
        ubiaNonSstb: 500_000,
        qualifiedReitPtpIncome: 0,
        taxableIncomeBeforeQbi: 300_000,
        netCapitalGain: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.regime).toBe("above");
    expect(out.componentSstb).toBe(0);
    expect(out.qbiDeduction).toBe(0);
    expect(out.notes.join(" ")).toContain("SSTB");
  });

  it("REIT/PTP: 20% × dividends added on top", () => {
    const out = qbi.compute(
      {
        qbiFromNonSstb: 50_000,
        qbiFromSstb: 0,
        w2WagesNonSstb: 0,
        ubiaNonSstb: 0,
        qualifiedReitPtpIncome: 10_000,
        taxableIncomeBeforeQbi: 100_000,
        netCapitalGain: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    // 50k × 20% = 10k + REIT 10k × 20% = 2k → 12k. Overall limit 100k × 20% = 20k → not binding.
    expect(out.componentReitPtp).toBe(2_000);
    expect(out.qbiDeduction).toBe(12_000);
  });

  it("Overall taxable-income limit can bind below pre-cap deduction", () => {
    // Big QBI, low taxable income (most of it was QBI itself; net capital gain reduces too).
    const out = qbi.compute(
      {
        qbiFromNonSstb: 100_000,
        qbiFromSstb: 0,
        w2WagesNonSstb: 0,
        ubiaNonSstb: 0,
        qualifiedReitPtpIncome: 0,
        taxableIncomeBeforeQbi: 50_000,
        netCapitalGain: 30_000,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.preCapDeduction).toBe(20_000);
    expect(out.overallLimit).toBe((50_000 - 30_000) * 0.2);
    expect(out.qbiDeduction).toBe(4_000);
  });
});
