import { describe, expect, it } from "vitest";
import { amt } from "./amt.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("AMT estimator — Form 6251", () => {
  it("Below exemption: AMTI < exemption → no taxable AMTI, no AMT", () => {
    const out = amt.compute(
      {
        regularTaxableIncome: 60_000,
        regularTaxLiability: 8_000,
        amtAdjustments: 5_000,
        amtPreferences: 0,
        isoBargainElement: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    // AMTI 65k < single exemption 85,700 → no tax
    expect(out.amti).toBe(65_000);
    expect(out.taxableAmti).toBe(0);
    expect(out.amtDue).toBe(0);
  });

  it("Single 2024 AMTI $200k → exempt $85,700, taxable $114,300 × 26% = $29,718", () => {
    const out = amt.compute(
      {
        regularTaxableIncome: 200_000,
        regularTaxLiability: 0, // force AMT
        amtAdjustments: 0,
        amtPreferences: 0,
        isoBargainElement: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.amti).toBe(200_000);
    expect(out.exemption).toBe(85_700);
    expect(out.taxableAmti).toBe(114_300);
    expect(out.tmt).toBeCloseTo(29_718, 0);
    expect(out.amtDue).toBeCloseTo(29_718, 0);
  });

  it("ISO bargain element flows into AMTI and surfaces a note", () => {
    const out = amt.compute(
      {
        regularTaxableIncome: 200_000,
        regularTaxLiability: 30_000,
        amtAdjustments: 0,
        amtPreferences: 0,
        isoBargainElement: 100_000,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.amti).toBe(300_000);
    expect(out.notes.some((n) => n.includes("ISO"))).toBe(true);
  });
});
