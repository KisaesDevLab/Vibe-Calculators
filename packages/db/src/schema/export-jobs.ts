import { pgTable, text, timestamp, integer, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { calculations } from "./calculations";

/**
 * Phase 13.7 — async export queue.
 *
 * Durable status store backing the BullMQ-based export queue. Files
 * land at /data/exports/{user_id}/{calc_id}/{timestamp}.{ext} and the
 * 30-day retention sweep walks `expires_at`.
 */

export const exportJobKindEnum = pgEnum("export_job_kind", [
  "tvm-pdf",
  "memo-pdf",
  "xlsx",
  "csv",
  "docx",
  "bulk-zip",
]);

export const exportJobStatusEnum = pgEnum("export_job_status", [
  "queued",
  "processing",
  "done",
  "failed",
]);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: exportJobKindEnum("kind").notNull(),
    status: exportJobStatusEnum("status").notNull().default("queued"),
    calculationId: text("calculation_id").references(() => calculations.id, {
      onDelete: "set null",
    }),
    calculationIds: jsonb("calculation_ids").$type<string[]>().notNull().default([]),
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    filename: text("filename"),
    filePath: text("file_path"),
    sizeBytes: integer("size_bytes"),
    progress: integer("progress").notNull().default(0),
    errorMessage: text("error_message"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("export_jobs_status_idx").on(t.status),
    requestedByIdx: index("export_jobs_requested_by_idx").on(t.requestedBy, t.requestedAt),
    expiresAtIdx: index("export_jobs_expires_at_idx").on(t.expiresAt),
  }),
);

export type ExportJobRow = typeof exportJobs.$inferSelect;
export type NewExportJobRow = typeof exportJobs.$inferInsert;
export type ExportJobKind = (typeof exportJobKindEnum.enumValues)[number];
export type ExportJobStatus = (typeof exportJobStatusEnum.enumValues)[number];
