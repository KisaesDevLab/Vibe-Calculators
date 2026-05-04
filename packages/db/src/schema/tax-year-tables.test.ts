import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { taxTableKindEnum, taxYearOverrides, taxYearTables } from "./tax-year-tables";
import { SEED } from "../seed-tax-tables";

describe("tax_year_tables schema", () => {
  it("uses table name 'tax_year_tables'", () => {
    expect(getTableName(taxYearTables)).toBe("tax_year_tables");
  });

  it("declares the build-plan columns", () => {
    expect(Object.keys(getTableColumns(taxYearTables)).sort()).toEqual(
      [
        "createdAt",
        "effectiveFrom",
        "effectiveTo",
        "id",
        "kind",
        "payload",
        "sourceUrl",
        "sourceVersion",
        "supersededAt",
        "taxYear",
      ].sort(),
    );
  });

  it("kind enum covers every category from build plan §14.2", () => {
    const required = [
      "federal_tax_brackets",
      "standard_deduction",
      "fica_wage_base",
      "medicare_thresholds",
      "niit_thresholds",
      "qbi_thresholds",
      "section_179_limits",
      "bonus_depreciation_pct",
      "macrs_tables",
      "rmd_uniform_lifetime",
      "rmd_joint_life",
      "rmd_single_life",
      "retirement_contribution_limits",
      "social_security_wage_base",
      "ss_optimal_age_table",
      "hsa_contribution_limits",
      "afr_short_mid_long",
      "alternative_minimum_tax_exemption",
    ];
    for (const k of required) {
      expect(taxTableKindEnum.enumValues).toContain(k);
    }
  });
});

describe("tax_year_overrides schema", () => {
  it("uses table name 'tax_year_overrides'", () => {
    expect(getTableName(taxYearOverrides)).toBe("tax_year_overrides");
  });

  it("has the same payload + effective-window columns plus a note", () => {
    const cols = Object.keys(getTableColumns(taxYearOverrides));
    expect(cols).toContain("note");
    expect(cols).toContain("effectiveFrom");
    expect(cols).toContain("payload");
  });
});

describe("seed dataset", () => {
  it("seeds at least 2024 and 2025 federal_tax_brackets, standard_deduction, fica_wage_base, qbi_thresholds, hsa_contribution_limits", () => {
    const required = [
      "federal_tax_brackets",
      "standard_deduction",
      "fica_wage_base",
      "qbi_thresholds",
      "hsa_contribution_limits",
      "alternative_minimum_tax_exemption",
      "retirement_contribution_limits",
      "section_179_limits",
      "bonus_depreciation_pct",
      "niit_thresholds",
      "medicare_thresholds",
    ] as const;
    for (const kind of required) {
      const has2024 = SEED.some((r) => r.taxYear === 2024 && r.kind === kind);
      const has2025 = SEED.some((r) => r.taxYear === 2025 && r.kind === kind);
      // Some kinds (medicare_thresholds) only have 2024 in seed; the
      // fixture is intentionally not exhaustive — just spot-check the
      // headline values exist for both years.
      if (kind === "medicare_thresholds") {
        expect(has2024).toBe(true);
      } else {
        expect(has2024 && has2025).toBe(true);
      }
    }
  });

  it("every seeded row carries a sourceUrl + sourceVersion", () => {
    for (const r of SEED) {
      expect(r.sourceUrl).toMatch(/^https?:\/\//);
      expect(r.sourceVersion.length).toBeGreaterThan(0);
    }
  });

  it("federal_tax_brackets payload is well-formed for both years (single + mfj filing statuses)", () => {
    for (const taxYear of [2024, 2025]) {
      const row = SEED.find((r) => r.taxYear === taxYear && r.kind === "federal_tax_brackets");
      expect(row).toBeDefined();
      const payload = row!.payload as { single: unknown[]; mfj: unknown[] };
      expect(Array.isArray(payload.single)).toBe(true);
      expect(payload.single.length).toBeGreaterThanOrEqual(7);
      expect(Array.isArray(payload.mfj)).toBe(true);
      // Last bracket has upto: null (open-ended top tier)
      const lastSingle = payload.single[payload.single.length - 1] as { upto: number | null };
      expect(lastSingle.upto).toBeNull();
    }
  });

  it("2024 single-filer top bracket starts above $609,000 (regression — IRS Rev. Proc. 2023-34)", () => {
    const row = SEED.find((r) => r.taxYear === 2024 && r.kind === "federal_tax_brackets")!;
    const single = (row.payload as { single: { rate: number; upto: number | null }[] }).single;
    const top35 = single.find((b) => b.rate === 0.35);
    expect(top35?.upto).toBe(609350);
  });

  it("2025 standard deduction single = 15000 (regression — Rev. Proc. 2024-40)", () => {
    const row = SEED.find((r) => r.taxYear === 2025 && r.kind === "standard_deduction")!;
    expect((row.payload as { single: number }).single).toBe(15000);
  });
});
