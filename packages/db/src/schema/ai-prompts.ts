import { pgTable, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 23.17 — versioned AI prompt store.
 *
 * Each prompt is keyed by `kind` (e.g. "loan-extraction") and a
 * monotonically-increasing `version`. The `active` row is the one the
 * extractor uses; setting a different row to active (via the admin
 * route) atomically deactivates its predecessors. Soft-deleted rows
 * (archivedAt) are retained for the audit trail.
 *
 * Used by Phase 23.8 — extraction routes read the active row and tag
 * the resulting extraction_jobs with promptVersion (added by the
 * upcoming follow-up). Setting active = false on every row falls back
 * to the hardcoded constants in @vibe-calc/llm/loan-extraction.
 */
export const aiPrompts = pgTable(
  "ai_prompts",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    /** Plain-text prompt body. */
    body: text("body").notNull(),
    /** System message prepended above the prompt. */
    systemMessage: text("system_message"),
    notes: text("notes"),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    kindVersionIdx: index("ai_prompts_kind_version_idx").on(t.kind, t.version),
    activeIdx: index("ai_prompts_active_idx").on(t.kind, t.active),
  }),
);

export type AiPromptRow = typeof aiPrompts.$inferSelect;
export type NewAiPromptRow = typeof aiPrompts.$inferInsert;
