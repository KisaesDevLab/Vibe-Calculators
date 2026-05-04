import { pgTable, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 2.8 — auth audit log.
 *
 * Insert-only. Each row links to the previous row via prev_hash,
 * forming a tamper-evident chain (Phase 21.3 will extend the same
 * pattern to general domain audit). The application is responsible
 * for computing and writing prev_hash + row_hash on insert; a CHECK
 * constraint at the DB level rejects rows missing either.
 *
 * `payload` is jsonb so each event kind can carry its own structured
 * detail (target user id for admin-driven changes, retryAfter for
 * lockouts, etc) without table-per-kind sprawl.
 *
 * `user_id` is nullable because failed-login and lockout events may
 * not resolve to a known user (e.g. typo'd email).
 */

export const authEventKindEnum = pgEnum("auth_event_kind", [
  "login.success",
  "login.failed",
  "login.locked",
  "lockout.cleared",
  "logout",
  "session.revoked",
  "password.set",
  "password.changed",
  "password.reset.requested",
  "password.reset.consumed",
  "magic_link.requested",
  "magic_link.consumed",
  "magic_link.consumed.failed",
  "totp.enrolled",
  "totp.disabled",
  "totp.recovery_used",
  "user.invited",
  "user.activated",
  "user.suspended",
  "user.unsuspended",
  "user.role_changed",
  "user.totp_required",
  "bootstrap.first_admin",
]);

export const authEvents = pgTable(
  "auth_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    kind: authEventKindEnum("kind").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash").notNull(),
    rowHash: text("row_hash").notNull(),
  },
  (t) => ({
    createdAtIdx: index("auth_events_created_at_idx").on(t.createdAt),
    userIdx: index("auth_events_user_idx").on(t.userId),
    kindIdx: index("auth_events_kind_idx").on(t.kind),
  }),
);

export type AuthEventRow = typeof authEvents.$inferSelect;
export type NewAuthEventRow = typeof authEvents.$inferInsert;
export type AuthEventKind = (typeof authEventKindEnum.enumValues)[number];

/**
 * Sentinel chain head — the prev_hash that the first row in the
 * table must reference. Never collides with a real SHA-256 because
 * its high bit is set explicitly via the leading 'g'.
 */
export const AUTH_EVENTS_GENESIS_HASH =
  "g0000000000000000000000000000000000000000000000000000000000000000";
