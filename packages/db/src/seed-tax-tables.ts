/**
 * Phase 14.3 — seed values for tax_year_tables.
 *
 * IMPORTANT: per session decision the values seeded here come from
 * IRS publications and Rev. Procs. but a CPA needs to spot-check
 * before they ship to a real firm. Each row carries `sourceUrl` and
 * `sourceVersion` so the audit trail is reproducible.
 *
 * Sources (as of seed time):
 *   - 2024: Rev. Proc. 2023-34 (federal brackets / std ded / other);
 *           IRS Pub 946 (Section 179 / bonus depr); SSA Press
 *           Release Oct 2023 (FICA wage base); IRS Notice 2023-75
 *           (retirement contrib limits); Rev. Proc. 2023-23 (HSA);
 *           Pub 590-B Appendix B (RMD lifetime tables — these
 *           change less frequently, current values are 2022 update).
 *   - 2025: Rev. Proc. 2024-40; IRS Notice 2024-80; Rev. Proc.
 *           2024-25 (HSA).
 *   - 2026: where published.
 *
 * Schema-shape inside `payload`:
 *   federal_tax_brackets: { single: [{rate, upto}, ...], mfj: [...], mfs: [...], hoh: [...], qw: [...] }
 *     where the last bracket has upto = null (open-ended).
 *   standard_deduction:   { single, mfj, mfs, hoh, qw }
 *   fica_wage_base:       { wageBase, oasdi: 0.062, medicare: 0.0145, additionalMedicare: 0.009 }
 *   medicare_thresholds:  { addtlMedicareSingle, addtlMedicareMfj, ... }
 *   niit_thresholds:      { single, mfj, mfs, hoh }
 *   qbi_thresholds:       { single, mfj, mfs, hoh, qw }  // taxable-income phase-in start
 *   section_179_limits:   { limit, phaseoutStart, suvCap }
 *   bonus_depreciation_pct: { pct, placedInServiceFrom?, placedInServiceTo? }
 *   hsa_contribution_limits: { selfOnly, family, catchup55, hdhpDeductible: {selfOnly, family}, hdhpOOPMax: {selfOnly, family} }
 *   retirement_contribution_limits: { 401k, 401kCatchup50, 401kCatchup60to63?, ira, iraCatchup50, sepIra: {pct, dollarCap}, simpleIra, simpleIraCatchup50, defBenAnnualMax }
 *   social_security_wage_base: { wageBase }
 *   alternative_minimum_tax_exemption: { single, mfj, mfs, phaseoutStartSingle, phaseoutStartMfj, phaseoutStartMfs }
 *
 * Tax tables that are mostly invariant across recent years (RMD
 * lifetime / single-life / joint-life tables, AFR rates, MACRS
 * tables, SS optimal-age table) are intentionally NOT seeded here
 * — they're large and the upstream calculator phases will seed
 * them when they need them.
 */

import pg from "pg";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { taxYearTables, type TaxTableKind } from "./schema/tax-year-tables";

interface SeedRow {
  taxYear: number;
  kind: TaxTableKind;
  effectiveFrom: Date;
  payload: Record<string, unknown>;
  sourceUrl: string;
  sourceVersion: string;
}

const utcJan1 = (year: number): Date => new Date(Date.UTC(year, 0, 1));

const SEED: SeedRow[] = [
  // -----------------------------------------------------------------
  // 2024 federal income tax brackets (Rev. Proc. 2023-34)
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "federal_tax_brackets",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
    sourceVersion: "Rev. Proc. 2023-34",
    payload: {
      single: [
        { rate: 0.1, upto: 11600 },
        { rate: 0.12, upto: 47150 },
        { rate: 0.22, upto: 100525 },
        { rate: 0.24, upto: 191950 },
        { rate: 0.32, upto: 243725 },
        { rate: 0.35, upto: 609350 },
        { rate: 0.37, upto: null },
      ],
      mfj: [
        { rate: 0.1, upto: 23200 },
        { rate: 0.12, upto: 94300 },
        { rate: 0.22, upto: 201050 },
        { rate: 0.24, upto: 383900 },
        { rate: 0.32, upto: 487450 },
        { rate: 0.35, upto: 731200 },
        { rate: 0.37, upto: null },
      ],
      mfs: [
        { rate: 0.1, upto: 11600 },
        { rate: 0.12, upto: 47150 },
        { rate: 0.22, upto: 100525 },
        { rate: 0.24, upto: 191950 },
        { rate: 0.32, upto: 243725 },
        { rate: 0.35, upto: 365600 },
        { rate: 0.37, upto: null },
      ],
      hoh: [
        { rate: 0.1, upto: 16550 },
        { rate: 0.12, upto: 63100 },
        { rate: 0.22, upto: 100500 },
        { rate: 0.24, upto: 191950 },
        { rate: 0.32, upto: 243700 },
        { rate: 0.35, upto: 609350 },
        { rate: 0.37, upto: null },
      ],
    },
  },
  // -----------------------------------------------------------------
  // 2025 federal income tax brackets (Rev. Proc. 2024-40)
  // -----------------------------------------------------------------
  {
    taxYear: 2025,
    kind: "federal_tax_brackets",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-24-40.pdf",
    sourceVersion: "Rev. Proc. 2024-40",
    payload: {
      single: [
        { rate: 0.1, upto: 11925 },
        { rate: 0.12, upto: 48475 },
        { rate: 0.22, upto: 103350 },
        { rate: 0.24, upto: 197300 },
        { rate: 0.32, upto: 250525 },
        { rate: 0.35, upto: 626350 },
        { rate: 0.37, upto: null },
      ],
      mfj: [
        { rate: 0.1, upto: 23850 },
        { rate: 0.12, upto: 96950 },
        { rate: 0.22, upto: 206700 },
        { rate: 0.24, upto: 394600 },
        { rate: 0.32, upto: 501050 },
        { rate: 0.35, upto: 751600 },
        { rate: 0.37, upto: null },
      ],
      mfs: [
        { rate: 0.1, upto: 11925 },
        { rate: 0.12, upto: 48475 },
        { rate: 0.22, upto: 103350 },
        { rate: 0.24, upto: 197300 },
        { rate: 0.32, upto: 250525 },
        { rate: 0.35, upto: 375800 },
        { rate: 0.37, upto: null },
      ],
      hoh: [
        { rate: 0.1, upto: 17000 },
        { rate: 0.12, upto: 64850 },
        { rate: 0.22, upto: 103350 },
        { rate: 0.24, upto: 197300 },
        { rate: 0.32, upto: 250500 },
        { rate: 0.35, upto: 626350 },
        { rate: 0.37, upto: null },
      ],
    },
  },
  // -----------------------------------------------------------------
  // Standard deduction
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "standard_deduction",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
    sourceVersion: "Rev. Proc. 2023-34",
    payload: { single: 14600, mfj: 29200, mfs: 14600, hoh: 21900, qw: 29200 },
  },
  {
    taxYear: 2025,
    kind: "standard_deduction",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-24-40.pdf",
    sourceVersion: "Rev. Proc. 2024-40",
    payload: { single: 15000, mfj: 30000, mfs: 15000, hoh: 22500, qw: 30000 },
  },
  // -----------------------------------------------------------------
  // FICA wage base + Medicare
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "fica_wage_base",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.ssa.gov/oact/cola/cbb.html",
    sourceVersion: "SSA fact sheet 2024",
    payload: {
      wageBase: 168600,
      oasdiRate: 0.062,
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
    },
  },
  {
    taxYear: 2025,
    kind: "fica_wage_base",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.ssa.gov/oact/cola/cbb.html",
    sourceVersion: "SSA fact sheet 2025",
    payload: {
      wageBase: 176100,
      oasdiRate: 0.062,
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
    },
  },
  {
    taxYear: 2024,
    kind: "medicare_thresholds",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/taxtopics/tc560",
    sourceVersion: "IRC §3101(b)(2)",
    payload: {
      addtlMedicareSingle: 200000,
      addtlMedicareMfj: 250000,
      addtlMedicareMfs: 125000,
      addtlMedicareHoh: 200000,
    },
  },
  // -----------------------------------------------------------------
  // NIIT thresholds (3.8% surtax) — fixed by IRC §1411, no annual indexing
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "niit_thresholds",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-8960",
    sourceVersion: "IRC §1411",
    payload: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000, qw: 250000 },
  },
  {
    taxYear: 2025,
    kind: "niit_thresholds",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-8960",
    sourceVersion: "IRC §1411",
    payload: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000, qw: 250000 },
  },
  // -----------------------------------------------------------------
  // QBI thresholds (Section 199A)
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "qbi_thresholds",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
    sourceVersion: "Rev. Proc. 2023-34",
    payload: {
      single: 191950,
      mfj: 383900,
      mfs: 191950,
      hoh: 191950,
      qw: 383900,
      phaseInRangeSingle: 50000,
      phaseInRangeMfj: 100000,
    },
  },
  {
    taxYear: 2025,
    kind: "qbi_thresholds",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-24-40.pdf",
    sourceVersion: "Rev. Proc. 2024-40",
    payload: {
      single: 197300,
      mfj: 394600,
      mfs: 197300,
      hoh: 197300,
      qw: 394600,
      phaseInRangeSingle: 50000,
      phaseInRangeMfj: 100000,
    },
  },
  // -----------------------------------------------------------------
  // Section 179
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "section_179_limits",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/publications/p946",
    sourceVersion: "Pub 946 (2024)",
    payload: { limit: 1160000, phaseoutStart: 2890000, suvCap: 28900 },
  },
  {
    taxYear: 2025,
    kind: "section_179_limits",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/publications/p946",
    sourceVersion: "Pub 946 (2025)",
    payload: { limit: 1250000, phaseoutStart: 3130000, suvCap: 31300 },
  },
  // -----------------------------------------------------------------
  // Bonus depreciation (Section 168(k)).
  // Pre-OBBBA phase-out: 80% in 2023, 60% in 2024, 40% in 2025,
  // 20% in 2026, 0% in 2027+. The OBBBA reinstated 100% for property
  // placed in service on/after 1/20/2025; an override row carries
  // that mid-year change in tax_year_overrides.
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "bonus_depreciation_pct",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/publications/p946",
    sourceVersion: "Pub 946 (2024) — IRC §168(k) phase-out",
    payload: { pct: 0.6 },
  },
  {
    taxYear: 2025,
    kind: "bonus_depreciation_pct",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/publications/p946",
    sourceVersion: "Pub 946 (2025) — IRC §168(k) phase-out",
    payload: { pct: 0.4 },
  },
  // -----------------------------------------------------------------
  // HSA limits (Rev. Proc. 2023-23 / 2024-25)
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "hsa_contribution_limits",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-23.pdf",
    sourceVersion: "Rev. Proc. 2023-23",
    payload: {
      selfOnly: 4150,
      family: 8300,
      catchup55: 1000,
      hdhpDeductible: { selfOnly: 1600, family: 3200 },
      hdhpOOPMax: { selfOnly: 8050, family: 16100 },
    },
  },
  {
    taxYear: 2025,
    kind: "hsa_contribution_limits",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-24-25.pdf",
    sourceVersion: "Rev. Proc. 2024-25",
    payload: {
      selfOnly: 4300,
      family: 8550,
      catchup55: 1000,
      hdhpDeductible: { selfOnly: 1650, family: 3300 },
      hdhpOOPMax: { selfOnly: 8300, family: 16600 },
    },
  },
  // -----------------------------------------------------------------
  // Retirement contribution limits (IRS Notice 2023-75 / 2024-80)
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "retirement_contribution_limits",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/n-23-75.pdf",
    sourceVersion: "IRS Notice 2023-75",
    payload: {
      "401k": 23000,
      "401kCatchup50": 7500,
      ira: 7000,
      iraCatchup50: 1000,
      sepIra: { pct: 0.25, dollarCap: 69000 },
      simpleIra: 16000,
      simpleIraCatchup50: 3500,
      defBenAnnualMax: 275000,
    },
  },
  {
    taxYear: 2025,
    kind: "retirement_contribution_limits",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/n-24-80.pdf",
    sourceVersion: "IRS Notice 2024-80",
    payload: {
      "401k": 23500,
      "401kCatchup50": 7500,
      "401kCatchup60to63": 11250,
      ira: 7000,
      iraCatchup50: 1000,
      sepIra: { pct: 0.25, dollarCap: 70000 },
      simpleIra: 16500,
      simpleIraCatchup50: 3500,
      simpleIraCatchup60to63: 5250,
      defBenAnnualMax: 280000,
    },
  },
  // -----------------------------------------------------------------
  // AMT exemption (Rev. Proc. 2023-34 / 2024-40)
  // -----------------------------------------------------------------
  {
    taxYear: 2024,
    kind: "alternative_minimum_tax_exemption",
    effectiveFrom: utcJan1(2024),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf",
    sourceVersion: "Rev. Proc. 2023-34",
    payload: {
      single: 85700,
      mfj: 133300,
      mfs: 66650,
      phaseoutStartSingle: 609350,
      phaseoutStartMfj: 1218700,
      phaseoutStartMfs: 609350,
    },
  },
  {
    taxYear: 2025,
    kind: "alternative_minimum_tax_exemption",
    effectiveFrom: utcJan1(2025),
    sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-24-40.pdf",
    sourceVersion: "Rev. Proc. 2024-40",
    payload: {
      single: 88100,
      mfj: 137000,
      mfs: 68500,
      phaseoutStartSingle: 626350,
      phaseoutStartMfj: 1252700,
      phaseoutStartMfs: 626350,
    },
  },
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required to seed tax tables.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString, max: 2 });
  const db = drizzle(pool);

  let inserted = 0;
  for (const row of SEED) {
    // Idempotent — only insert if no row with the same
    // (taxYear, kind, effectiveFrom).
    const existing = await db
      .select({ id: taxYearTables.id })
      .from(taxYearTables)
      .where(
        and(
          eq(taxYearTables.taxYear, row.taxYear),
          eq(taxYearTables.kind, row.kind),
          eq(taxYearTables.effectiveFrom, row.effectiveFrom),
        ),
      );
    if (existing.length > 0) continue;
    await db.insert(taxYearTables).values(row);
    inserted++;
  }
  console.info(`[seed-tax-tables] inserted ${inserted} of ${SEED.length} rows`);
  await pool.end();
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && /seed-tax-tables/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error("[seed-tax-tables] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { SEED };
