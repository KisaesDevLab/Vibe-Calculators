import { pgTable, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients";
import { users } from "./users";

/**
 * Phase 3.2 — engagements.
 *
 * An engagement bundles the work for a client in a given tax year
 * (or other scope). status drives the review workflow that Phase 21
 * elaborates: draft -> in_review -> approved -> closed.
 */

export const engagementStatusEnum = pgEnum("engagement_status", [
  "draft",
  "in_review",
  "approved",
  "closed",
]);

export const engagementTypeEnum = pgEnum("engagement_type", [
  "tax_planning",
  "tax_prep",
  "advisory",
  "loan_modeling",
  "audit_support",
  "other",
]);

export const engagements = pgTable(
  "engagements",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    taxYear: integer("tax_year"),
    engagementType: engagementTypeEnum("engagement_type").notNull().default("advisory"),
    status: engagementStatusEnum("status").notNull().default("draft"),
    assignedPreparerId: text("assigned_preparer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedReviewerId: text("assigned_reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    clientIdx: index("engagements_client_idx").on(t.clientId),
    statusIdx: index("engagements_status_idx").on(t.status),
    nameIdx: index("engagements_name_idx").on(t.name),
    archivedIdx: index("engagements_archived_idx").on(t.archivedAt),
  }),
);

export type EngagementRow = typeof engagements.$inferSelect;
export type NewEngagementRow = typeof engagements.$inferInsert;
export type EngagementStatus = (typeof engagementStatusEnum.enumValues)[number];
export type EngagementType = (typeof engagementTypeEnum.enumValues)[number];
