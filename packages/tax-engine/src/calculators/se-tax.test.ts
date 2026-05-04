import { describe, expect, it } from "vitest";
import { seTax } from "./se-tax.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("SE tax — Schedule SE", () => {
  it("$100,000 SE earnings, 2024, no W-2 → matches Schedule SE worksheet", () => {
    const out = seTax.compute(
      {
        netSeEarnings: 100_000,
        w2WagesSubjectToOasdi: 0,
        w2WagesTotal: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    // Net SE = 100,000 × 92.35% = 92,350
    expect(out.netSeEarningsAfterMultiplier).toBeCloseTo(92_350, 0);
    // OASDI = 92,350 × 12.4% = 11,451.40
    expect(out.oasdiTax).toBeCloseTo(11_451.4, 2);
    // Medicare = 92,350 × 2.9% = 2,678.15
    expect(out.medicareTax).toBeCloseTo(2_678.15, 2);
    // Total = 14,129.55
    expect(out.totalSeTax).toBeCloseTo(14_129.55, 2);
    // Half-SE = 14,129.55 / 2 = 7,064.78 (within rounding)
    expect(out.halfSeDeduction).toBeCloseTo(7_064.78, 2);
  });

  it("$400 SE: under threshold, no SE tax", () => {
    const out = seTax.compute(
      {
        netSeEarnings: 400,
        w2WagesSubjectToOasdi: 0,
        w2WagesTotal: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.totalSeTax).toBe(0);
    expect(out.notes[0]).toContain("$400");
  });

  it("OASDI capped by W-2 wages: $150k W-2 + $50k SE in 2024 → OASDI room limited", () => {
    // 2024 wage base $168,600. W-2 $150k consumes $150k of base. Room left = $18,600.
    // SE net = $50k × 92.35% = $46,175. OASDI base = min($46,175, $18,600) = $18,600.
    const out = seTax.compute(
      {
        netSeEarnings: 50_000,
        w2WagesSubjectToOasdi: 150_000,
        w2WagesTotal: 150_000,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.oasdiBase).toBeCloseTo(18_600, 0);
    expect(out.oasdiTax).toBeCloseTo(18_600 * 0.124, 2);
  });

  it("Additional Medicare 0.9%: $300k SE single → tax on $100k over threshold", () => {
    // $300k × 92.35% = $277,050 SE net. Threshold $200k single.
    // Excess = 277,050 - 200,000 = 77,050. AdditionalMed = 77,050 × 0.9% = 693.45.
    const out = seTax.compute(
      {
        netSeEarnings: 300_000,
        w2WagesSubjectToOasdi: 0,
        w2WagesTotal: 0,
        filingStatus: "single",
        taxYear: 2024,
      },
      ctx,
    );
    expect(out.additionalMedicareTax).toBeCloseTo(693.45, 2);
  });
});
