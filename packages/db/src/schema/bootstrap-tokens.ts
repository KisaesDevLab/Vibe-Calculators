import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Dead schema — the bootstrap-token install ceremony was retired in
 * Phase 25.3 (revised) in favor of a seeded default admin with a
 * forced first-login password change. The table itself is left in
 * place to avoid a destructive drop migration; nothing in the running
 * application reads or writes it.
 */
export const bootstrapTokens = pgTable("bootstrap_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type BootstrapTokenRow = typeof bootstrapTokens.$inferSelect;
export type NewBootstrapTokenRow = typeof bootstrapTokens.$inferInsert;
