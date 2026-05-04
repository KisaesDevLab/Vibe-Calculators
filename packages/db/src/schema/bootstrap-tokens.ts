import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One-shot install bootstrap tokens.
 *
 * The operator runs `just bootstrap` (or the upcoming Phase 25
 * installer) once after a fresh install. That generates a 32-byte
 * random token, hashes it with SHA-256, and inserts the hash here.
 * The bare token is printed to stdout exactly once for the operator
 * to paste into /setup.
 *
 * The /api/v1/setup route looks up the supplied token's hash in this
 * table. On successful first-admin creation the row is deleted; the
 * operator must re-run `just bootstrap` if they want to issue another
 * token (which is only useful before any user exists, since the route
 * also refuses to run when users.count > 0).
 *
 * State here survives API restarts — that's the whole reason it's a
 * table rather than in-memory state.
 */
export const bootstrapTokens = pgTable("bootstrap_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type BootstrapTokenRow = typeof bootstrapTokens.$inferSelect;
export type NewBootstrapTokenRow = typeof bootstrapTokens.$inferInsert;
