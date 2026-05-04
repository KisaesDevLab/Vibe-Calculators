import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients";
import { engagements } from "./engagements";
import { users } from "./users";

/**
 * Phase 3.3 — calculations + 3.4 calculation_versions.
 *
 * `calculations` is the logical record (current state); every save
 * also writes an immutable row to `calculation_versions` and updates
 * `calculations.current_version_id` to point at it. Rollback creates
 * a NEW version row that copies a prior version's payload, so
 * history is never lost.
 */

export const calculationKindEnum = pgEnum("calculation_kind", [
  // Phase 6+ TVM
  "tvm.amortization",
  "tvm.bond",
  "tvm.lease_842",
  "tvm.tdr",
  "tvm.imputed_interest",
  "tvm.below_market_loan",
  "tvm.sinking_fund",
  "tvm.lease_factor",
  "tvm.note_yield",
  "tvm.irr_npv",
  "tvm.cash_flow_event_grid",
  // Phase 16+ tax
  "tax.macrs",
  "tax.section_179",
  "tax.bonus_depreciation",
  "tax.depreciation_combined",
  "tax.cost_seg",
  "tax.rmd",
  "tax.roth_conversion",
  "tax.capital_gains",
  "tax.qbi",
  "tax.safe_harbor",
  "tax.se_tax",
  "tax.state_estimate",
  "tax.amt",
  "tax.section_1031",
  "tax.installment_sale",
  "tax.section_121",
  "tax.irs_interest_penalty",
  "tax.hsa",
  "tax.qualified_plan",
  "tax.social_security_age",
  // Sentinel for ad-hoc / future kinds
  "other",
]);

export const calculationStatusEnum = pgEnum("calculation_status", [
  "draft",
  "ready_for_review",
  "approved",
]);

/**
 * `calculations` — logical record.
 */
export const calculations = pgTable(
  "calculations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    engagementId: text("engagement_id").references(() => engagements.id, {
      onDelete: "set null",
    }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    kind: calculationKindEnum("kind").notNull(),
    name: text("name").notNull(),
    inputsJson: jsonb("inputs_json").$type<Record<string, unknown>>().notNull().default({}),
    outputsJson: jsonb("outputs_json").$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    computedBy: text("computed_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    parentId: text("parent_id").references((): AnyPgColumn => calculations.id, {
      onDelete: "set null",
    }),
    currentVersionId: text("current_version_id"),
    status: calculationStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    engagementIdx: index("calculations_engagement_idx").on(t.engagementId),
    clientIdx: index("calculations_client_idx").on(t.clientId),
    kindIdx: index("calculations_kind_idx").on(t.kind),
    statusIdx: index("calculations_status_idx").on(t.status),
    nameIdx: index("calculations_name_idx").on(t.name),
    parentIdx: index("calculations_parent_idx").on(t.parentId),
    archivedIdx: index("calculations_archived_idx").on(t.archivedAt),
  }),
);

/**
 * `calculation_versions` — immutable history. Every save inserts a
 * row; `calculations.current_version_id` points at the most-recent.
 * Approved-and-locked versions are detected via `lockedAt IS NOT NULL`.
 */
export const calculationVersions = pgTable(
  "calculation_versions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    calculationId: text("calculation_id")
      .notNull()
      .references(() => calculations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    inputsJson: jsonb("inputs_json").$type<Record<string, unknown>>().notNull().default({}),
    outputsJson: jsonb("outputs_json").$type<Record<string, unknown>>().notNull().default({}),
    rowAnnotations: jsonb("row_annotations").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    computedBy: text("computed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    calcIdx: index("calc_versions_calc_idx").on(t.calculationId),
    calcVersionIdx: index("calc_versions_calc_version_idx").on(t.calculationId, t.version),
  }),
);

export type CalculationRow = typeof calculations.$inferSelect;
export type NewCalculationRow = typeof calculations.$inferInsert;
export type CalculationVersionRow = typeof calculationVersions.$inferSelect;
export type NewCalculationVersionRow = typeof calculationVersions.$inferInsert;
export type CalculationKind = (typeof calculationKindEnum.enumValues)[number];
export type CalculationStatus = (typeof calculationStatusEnum.enumValues)[number];
