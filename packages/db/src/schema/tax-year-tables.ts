import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 14 — tax-year rate tables.
 *
 * Every published IRS / SSA / state value the tax calculators
 * consume lives here, scoped by (tax_year, kind). The payload is
 * a jsonb document whose shape depends on `kind`. Phase 14.4
 * requires every tax-calculation row (Phase 3 calculations) to
 * persist the row IDs it consumed so a recompute under the same
 * tax year is reproducible.
 *
 * The annual-update workflow (§14.5) inserts new rows alongside
 * existing ones; the runtime resolver picks the row whose
 * effective_from..effective_to range contains the calculation date
 * (or simply matches the tax_year for non-mid-year values).
 *
 * `tax_year_overrides` (§14.7) is the escape hatch for OBBBA /
 * SECURE 2.0 retroactive changes — a high-priority alternate
 * payload for an existing row that the resolver checks first.
 */

export const taxTableKindEnum = pgEnum("tax_table_kind", [
  // Federal income-tax structure
  "federal_tax_brackets",
  "standard_deduction",
  "alternative_minimum_tax_exemption",
  // Wage-base / FICA / Medicare
  "fica_wage_base",
  "medicare_thresholds",
  "niit_thresholds",
  // QBI (Section 199A)
  "qbi_thresholds",
  // Depreciation
  "section_179_limits",
  "bonus_depreciation_pct",
  "macrs_tables",
  // Retirement
  "rmd_uniform_lifetime",
  "rmd_joint_life",
  "rmd_single_life",
  "retirement_contribution_limits",
  "social_security_wage_base",
  "ss_optimal_age_table",
  // HSA
  "hsa_contribution_limits",
  // Applicable Federal Rates
  "afr_short_mid_long",
]);

export const taxYearTables = pgTable(
  "tax_year_tables",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    taxYear: integer("tax_year").notNull(),
    kind: taxTableKindEnum("kind").notNull(),
    /** Date the value first applies (for mid-year changes). Most
     *  rows: Jan 1 of taxYear. */
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    /** Inclusive end date. Null = still in effect. */
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    /** The structured value. Shape depends on `kind`. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** URL to the publishing source (IRS Pub, Rev. Proc., etc). */
    sourceUrl: text("source_url"),
    /** Human-readable identifier for the source revision. */
    sourceVersion: text("source_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** When set, this row has been superseded by a corrected version
     *  (Phase 14.8 stale-banner). */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => ({
    yearKindIdx: index("tax_year_tables_year_kind_idx").on(t.taxYear, t.kind),
    effFromIdx: index("tax_year_tables_eff_from_idx").on(t.effectiveFrom),
  }),
);

export type TaxYearTableRow = typeof taxYearTables.$inferSelect;
export type NewTaxYearTableRow = typeof taxYearTables.$inferInsert;
export type TaxTableKind = (typeof taxTableKindEnum.enumValues)[number];

/**
 * Phase 14.7 — overrides table for legislative changes that drop
 * mid-year (OBBBA, SECURE 2.0). The resolver checks here first;
 * unmatched falls through to tax_year_tables.
 */
export const taxYearOverrides = pgTable(
  "tax_year_overrides",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    taxYear: integer("tax_year").notNull(),
    kind: taxTableKindEnum("kind").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sourceUrl: text("source_url"),
    sourceVersion: text("source_version"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyIdx: uniqueIndex("tax_year_overrides_key_idx").on(t.taxYear, t.kind, t.effectiveFrom),
  }),
);

export type TaxYearOverrideRow = typeof taxYearOverrides.$inferSelect;
export type NewTaxYearOverrideRow = typeof taxYearOverrides.$inferInsert;
