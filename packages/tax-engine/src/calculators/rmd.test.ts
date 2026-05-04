import { describe, expect, it } from "vitest";
import { rmd } from "./rmd.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("RMD — Pub 590-B + SECURE 2.0", () => {
  it("Owner age 73 in 2024, $500k balance: divisor 26.5 → $18,867.92", () => {
    // Born 1951 → age 73 in 2024
    const out = rmd.compute(
      {
        priorYearEndBalance: 500_000,
        ownerBirthYear: 1951,
        distributionYear: 2024,
        mode: "uniform",
        accountType: "traditional_ira",
        isInherited: false,
        beneficiaryIsEdb: false,
      },
      ctx,
    );
    expect(out.rmdRequired).toBe(true);
    expect(out.divisor).toBe(26.5);
    expect(out.rmdAmount).toBeCloseTo(18867.92, 2);
    expect(out.startAge).toBe(73);
  });

  it("Born 1960: SECURE 2.0 start age is 75 — no RMD at age 73", () => {
    const out = rmd.compute(
      {
        priorYearEndBalance: 500_000,
        ownerBirthYear: 1960,
        distributionYear: 2033,
        mode: "uniform",
        accountType: "traditional_ira",
        isInherited: false,
        beneficiaryIsEdb: false,
      },
      ctx,
    );
    expect(out.rmdRequired).toBe(false);
    expect(out.startAge).toBe(75);
  });

  it("Roth IRA: SECURE 2.0 §325 — narrate flags no lifetime RMD", () => {
    const out = rmd.compute(
      {
        priorYearEndBalance: 500_000,
        ownerBirthYear: 1950,
        distributionYear: 2024,
        mode: "uniform",
        accountType: "roth_ira",
        isInherited: false,
        beneficiaryIsEdb: false,
      },
      ctx,
    );
    expect(out.notes.some((n) => n.includes("Roth"))).toBe(true);
  });

  it("Inherited IRA, decedent died 2021, non-EDB → 10-year rule note surfaces", () => {
    const out = rmd.compute(
      {
        priorYearEndBalance: 200_000,
        ownerBirthYear: 1955,
        distributionYear: 2024,
        mode: "single_life",
        beneficiaryBirthYear: 1980,
        accountType: "traditional_ira",
        isInherited: true,
        decedentDeathYear: 2021,
        beneficiaryIsEdb: false,
      },
      ctx,
    );
    expect(out.rule).toContain("10-year rule");
    expect(out.notes[0]).toContain("non-EDB");
  });
});
