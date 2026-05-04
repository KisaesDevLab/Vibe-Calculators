import { pgTable, text, timestamp, jsonb, pgEnum, index, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { clients } from "./clients";
import { engagements } from "./engagements";

/**
 * Phase 23 — AI-assisted extraction jobs + results.
 *
 * Each `extraction_jobs` row pairs an uploaded loan-doc with the
 * extracted structured payload. Per-firm review state is tracked so
 * a CPA can lock an extraction as "approved" before it's used to
 * seed a calculation.
 */

export const extractionStatusEnum = pgEnum("extraction_status", [
  "pending",
  "processing",
  "needs_review",
  "approved",
  "failed",
]);

export const extractionJobs = pgTable(
  "extraction_jobs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Optional pinning to client / engagement. */
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    engagementId: text("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    sourceFilename: text("source_filename").notNull(),
    /** Document text — for now we accept paste-in text or pre-OCRed PDF. */
    documentText: text("document_text").notNull(),
    status: extractionStatusEnum("status").notNull().default("pending"),
    /** Extracted JSON (shape governed by @vibe-calc/llm loanExtractionSchema). */
    extractedJson: jsonb("extracted_json").$type<Record<string, unknown>>().default({}),
    /** Field-level confidence (0..1) keyed by field name. */
    fieldConfidence: jsonb("field_confidence").$type<Record<string, number>>().default({}),
    /** Provider response id for audit. */
    providerResponseId: text("provider_response_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("extraction_jobs_status_idx").on(t.status),
    clientIdx: index("extraction_jobs_client_idx").on(t.clientId),
    engagementIdx: index("extraction_jobs_engagement_idx").on(t.engagementId),
    createdByIdx: index("extraction_jobs_created_by_idx").on(t.createdBy),
  }),
);

export type ExtractionJobRow = typeof extractionJobs.$inferSelect;
export type NewExtractionJobRow = typeof extractionJobs.$inferInsert;
export type ExtractionStatus = (typeof extractionStatusEnum.enumValues)[number];
