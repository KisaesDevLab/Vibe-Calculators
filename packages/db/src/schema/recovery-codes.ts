import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 2.5 — TOTP recovery codes.
 *
 * Single-use backup codes a user can redeem when they lose access to
 * their authenticator app. The bare codes are shown to the user once
 * (during enrollment); the database only ever stores the SHA-256 hex
 * digest. Consumed codes are kept (with consumed_at populated) for
 * audit purposes.
 */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("recovery_codes_user_idx").on(t.userId),
    hashIdx: index("recovery_codes_hash_idx").on(t.codeHash),
  }),
);

export type RecoveryCodeRow = typeof recoveryCodes.$inferSelect;
export type NewRecoveryCodeRow = typeof recoveryCodes.$inferInsert;
