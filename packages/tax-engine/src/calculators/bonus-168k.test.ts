import { describe, expect, it } from "vitest";
import { bonus168k } from "./bonus-168k.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Bonus depreciation §168(k) — phase-out + OBBBA cutover", () => {
  it("2024 placed in service: 60% bonus", () => {
    const out = bonus168k.compute(
      {
        basisAfter179: 100000,
        taxYear: 2024,
        placedInServiceDate: "2024-06-15",
        propertyClass: "5",
        electOut: false,
      },
      ctx,
    );
    expect(out.bonusPctApplied).toBeCloseTo(0.6, 5);
    expect(out.bonusDepreciation).toBe(60000);
    expect(out.basisAfterBonus).toBe(40000);
  });

  it("OBBBA cutover: property placed in service 2025-01-19 → 40% bonus", () => {
    const out = bonus168k.compute(
      {
        basisAfter179: 100000,
        taxYear: 2025,
        placedInServiceDate: "2025-01-19",
        propertyClass: "5",
        electOut: false,
      },
      ctx,
    );
    expect(out.bonusPctApplied).toBeCloseTo(0.4, 5);
    expect(out.bonusDepreciation).toBe(40000);
  });

  it("OBBBA cutover: property placed in service 2025-01-20 → 100% bonus", () => {
    const out = bonus168k.compute(
      {
        basisAfter179: 100000,
        taxYear: 2025,
        placedInServiceDate: "2025-01-20",
        propertyClass: "5",
        electOut: false,
      },
      ctx,
    );
    expect(out.bonusPctApplied).toBeCloseTo(1.0, 5);
    expect(out.bonusDepreciation).toBe(100000);
    expect(out.basisAfterBonus).toBe(0);
    expect(out.rateSource).toContain("OBBBA");
  });

  it("Election out preserves full basis to MACRS", () => {
    const out = bonus168k.compute(
      {
        basisAfter179: 100000,
        taxYear: 2024,
        placedInServiceDate: "2024-06-15",
        propertyClass: "5",
        electOut: true,
      },
      ctx,
    );
    expect(out.electedOut).toBe(true);
    expect(out.bonusDepreciation).toBe(0);
    expect(out.basisAfterBonus).toBe(100000);
  });

  it("2027+: bonus is 0%", () => {
    const out = bonus168k.compute(
      {
        basisAfter179: 100000,
        taxYear: 2027,
        placedInServiceDate: "2027-06-15",
        propertyClass: "5",
        electOut: false,
      },
      ctx,
    );
    expect(out.bonusPctApplied).toBe(0);
    expect(out.bonusDepreciation).toBe(0);
  });
});
