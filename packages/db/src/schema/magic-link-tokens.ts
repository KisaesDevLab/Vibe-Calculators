import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Phase 2.6 — magic-link tokens.
 *
 * Same hash-only-storage pattern as password-reset tokens, plus an
 * `ip_bound` column: the magic link can be consumed only from the
 * IP that requested it (build plan §2.6 "IP-bound"). 15-minute TTL
 * is enforced at request-time via `expires_at`.
 */
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ipBound: text("ip_bound").notNull(),
  },
  (t) => ({
    userIdx: index("magic_link_user_idx").on(t.userId),
    expiresIdx: index("magic_link_expires_idx").on(t.expiresAt),
  }),
);

export type MagicLinkTokenRow = typeof magicLinkTokens.$inferSelect;
export type NewMagicLinkTokenRow = typeof magicLinkTokens.$inferInsert;
