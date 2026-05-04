import { describe, expect, it } from "vitest";
import { capitalGains } from "./capital-gains.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Capital gains / loss harvesting", () => {
  it("Single long-term gain: holds > 365 days, gain $5,000", () => {
    const out = capitalGains.compute(
      {
        lots: [
          {
            lotId: "AAPL-001",
            acquisitionDate: "2022-01-15",
            saleDate: "2024-06-15",
            costBasis: 10_000,
            saleProceeds: 15_000,
            isQsbs: false,
            replacementPurchaseDates: [],
          },
        ],
        magi: 150_000,
        filingStatus: "single",
        priorLossCarryover: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.perLot[0]?.isLongTerm).toBe(true);
    expect(out.perLot[0]?.realizedGain).toBe(5000);
    expect(out.netLongTermGain).toBe(5000);
    expect(out.totalCapitalGain).toBe(5000);
  });

  it("Net loss with $4k loss: $3k ordinary offset, $1k carryover", () => {
    const out = capitalGains.compute(
      {
        lots: [
          {
            lotId: "TSLA-001",
            acquisitionDate: "2023-01-01",
            saleDate: "2024-06-15",
            costBasis: 20_000,
            saleProceeds: 16_000,
            isQsbs: false,
            replacementPurchaseDates: [],
          },
        ],
        magi: 100_000,
        filingStatus: "single",
        priorLossCarryover: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.netLongTermGain).toBe(-4000);
    expect(out.ordinaryLossOffset).toBe(3000);
    expect(out.carryoverToNextYear).toBe(1000);
    expect(out.totalCapitalGain).toBe(0);
  });

  it("Wash-sale: loss within 30 days of replacement is disallowed", () => {
    const out = capitalGains.compute(
      {
        lots: [
          {
            lotId: "X-001",
            acquisitionDate: "2024-01-01",
            saleDate: "2024-05-01",
            costBasis: 10_000,
            saleProceeds: 8_000,
            isQsbs: false,
            replacementPurchaseDates: ["2024-05-15"],
          },
        ],
        magi: 100_000,
        filingStatus: "single",
        priorLossCarryover: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.perLot[0]?.washSaleFlag).toBe(true);
    expect(out.netLongTermGain).toBe(0);
    expect(out.netShortTermGain).toBe(0);
  });

  it("QSBS held >5y, acquired post-2010-09-28: 100% exclusion", () => {
    const out = capitalGains.compute(
      {
        lots: [
          {
            lotId: "QSBS-001",
            acquisitionDate: "2018-06-15",
            saleDate: "2024-07-01",
            costBasis: 100_000,
            saleProceeds: 1_000_000,
            isQsbs: true,
            replacementPurchaseDates: [],
          },
        ],
        magi: 200_000,
        filingStatus: "single",
        priorLossCarryover: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.perLot[0]?.qsbsExclusionPct).toBe(1.0);
    expect(out.perLot[0]?.qsbsExcludedAmount).toBe(900_000);
    expect(out.perLot[0]?.taxableGain).toBe(0);
  });

  it("NIIT: single $300k MAGI with $50k net gain → 3.8% × $50k = $1,900", () => {
    const out = capitalGains.compute(
      {
        lots: [
          {
            lotId: "X",
            acquisitionDate: "2022-01-15",
            saleDate: "2024-06-15",
            costBasis: 0,
            saleProceeds: 50_000,
            isQsbs: false,
            replacementPurchaseDates: [],
          },
        ],
        magi: 300_000,
        filingStatus: "single",
        priorLossCarryover: 0,
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.totalCapitalGain).toBe(50_000);
    // excess MAGI = 300k - 200k = 100k; NII = 50k → NIIT base = min(50k, 100k) = 50k × 3.8% = 1,900
    expect(out.netInvestmentIncomeTax).toBe(1900);
  });
});
