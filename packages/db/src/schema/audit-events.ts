import { pgTable, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 21.3 — domain audit events with tamper-evident hash chain.
 *
 * Mirrors the auth_events shape (Phase 2.8): insert-only, prev_hash
 * + row_hash chain, sentinel genesis. Distinct table because the
 * cardinality is much higher and the queries are different (per-
 * entity replay rather than security audit).
 */

export const auditActionEnum = pgEnum("audit_action", [
  // Calculation lifecycle
  "calculation.create",
  "calculation.save",
  "calculation.submit_for_review",
  "calculation.approve",
  "calculation.reject",
  "calculation.rollback",
  "calculation.archive",
  "calculation.restore",
  "calculation.comment",
  "calculation.lock",
  // Engagement workflow
  "engagement.create",
  "engagement.transition",
  "engagement.assign",
  "engagement.archive",
  "engagement.restore",
  // Client mutations
  "client.create",
  "client.update",
  "client.archive",
  "client.restore",
  // Tagging
  "tag.attach",
  "tag.detach",
  // Bulk
  "bulk.archive",
  "bulk.reassign",
  "bulk.change_tax_year",
  // Export
  "export.created",
  "export.downloaded",
  // Backup / restore (Phase 25.8)
  "backup.created",
  "backup.restore.requested",
]);

export const auditEntityKindEnum = pgEnum("audit_entity_kind", [
  "client",
  "engagement",
  "calculation",
  "calculation_version",
  "tag",
  "user",
  "backup",
]);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    action: auditActionEnum("action").notNull(),
    entityKind: auditEntityKindEnum("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Free-form structured detail keyed by action. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Hash chain — mirrors auth_events. */
    prevHash: text("prev_hash").notNull(),
    rowHash: text("row_hash").notNull(),
  },
  (t) => ({
    createdAtIdx: index("audit_events_created_at_idx").on(t.createdAt),
    entityIdx: index("audit_events_entity_idx").on(t.entityKind, t.entityId),
    actionIdx: index("audit_events_action_idx").on(t.action),
    actorIdx: index("audit_events_actor_idx").on(t.actorUserId),
  }),
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
export type AuditAction = (typeof auditActionEnum.enumValues)[number];
export type AuditEntityKind = (typeof auditEntityKindEnum.enumValues)[number];

export const AUDIT_EVENTS_GENESIS_HASH =
  "g0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Calculation comments — threaded review notes on a specific
 * calculation_version (Phase 21.5).
 */
export const calculationComments = pgTable(
  "calculation_comments",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    calculationId: text("calculation_id").notNull(),
    versionId: text("version_id"),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** When the comment is in response to a review action — surfaces in UI. */
    kind: text("kind").notNull().default("note"),
  },
  (t) => ({
    calcIdx: index("calc_comments_calc_idx").on(t.calculationId),
    versionIdx: index("calc_comments_version_idx").on(t.versionId),
    authorIdx: index("calc_comments_author_idx").on(t.authorId),
  }),
);

export type CalculationCommentRow = typeof calculationComments.$inferSelect;
export type NewCalculationCommentRow = typeof calculationComments.$inferInsert;
