import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Schema-meta table.
 *
 * One row per "schema generation" — written by the bootstrap migration
 * and updated by future schema changes. Used by /api/health/deep
 * (Phase 25) and by the upgrade workflow to verify schema parity.
 */
export const _meta = pgTable("_meta", {
  schemaVersion: text("schema_version").primaryKey(),
  bootstrappedAt: timestamp("bootstrapped_at", { withTimezone: true }).defaultNow().notNull(),
  notes: text("notes"),
});

export type MetaRow = typeof _meta.$inferSelect;
export type NewMetaRow = typeof _meta.$inferInsert;
