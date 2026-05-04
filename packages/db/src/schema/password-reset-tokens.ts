import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Phase 2 — password-reset tokens.
 *
 * The token primary key stores the SHA-256 hex digest of the raw
 * token. The bare value is shown to the user exactly once and never
 * landed in a database column or log line. Lookup at consumption is
 * a single hash + indexed PK lookup; offline DB compromise does not
 * leak active reset tokens.
 *
 * `consumed_at` marks one-time use; the row is kept for auditability
 * but cannot be redeemed twice.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedFromIp: text("requested_from_ip"),
  },
  (t) => ({
    userIdx: index("password_reset_user_idx").on(t.userId),
    expiresIdx: index("password_reset_expires_idx").on(t.expiresAt),
  }),
);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenRow = typeof passwordResetTokens.$inferInsert;
