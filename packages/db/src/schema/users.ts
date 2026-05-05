import {
  pgTable,
  text,
  timestamp,
  boolean,
  bigint,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 2.1 — users.
 *
 * Email is the primary login identifier. The application normalizes
 * to lowercase before insert/lookup; the unique index lives on the
 * stored value, so the application contract is the source of truth
 * for case-folding (citext would also work but adds a non-default
 * extension dependency).
 *
 * `password_hash` is nullable to support magic-link-only users who
 * never set a password (Phase 2.6). Set to non-null when the user
 * runs through the password-set flow (Phase 2.11).
 *
 * `totp_secret` is the *encrypted-at-rest* TOTP shared secret (Phase
 * 2.5 wraps it via VIBE_KMS_KEY); the bare base32 value never lands
 * in this column.
 */

export const userRoleEnum = pgEnum("user_role", ["admin", "reviewer", "preparer", "readonly"]);

export const userStatusEnum = pgEnum("user_status", ["pending", "active", "suspended"]);

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").notNull().default("preparer"),
    status: userStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    /**
     * Last accepted TOTP step counter. Each successful verify advances
     * this so the same code (which is valid for 30s) cannot be replayed
     * within its window. Persisting at the user row keeps the check
     * single-table.
     */
    totpLastCounter: bigint("totp_last_counter", { mode: "number" }),
    /**
     * Phase 22.7 — email digest preference.
     *   immediate    - send every notification as a standalone message
     *                  (default)
     *   daily        - batch overnight; ship one summary at 7am firm-tz
     *   off          - never email (in-app only). Account-recovery and
     *                  magic-link emails ignore this setting.
     */
    emailDigest: text("email_digest").notNull().default("immediate"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
    statusIdx: index("users_status_idx").on(t.status),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
