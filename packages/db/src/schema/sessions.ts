import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 2.4 — server-side sessions.
 *
 * The cookie carries an opaque session ID; all session metadata
 * lives here so revoking a session is a row delete. `expires_at` is
 * the rolling window (extended on activity, capped by the absolute
 * `absolute_expires_at` written at session creation).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /**
     * Single sign-on (migration 0022). Set only on sessions minted by
     * the OIDC callback; NULL for password / magic-link / break-glass
     * sessions. `oidc_sid` is the IdP's session id (back-channel logout
     * targets it); `oidc_id_token` is the KMS-sealed ID token kept for
     * the RP-initiated logout hint.
     */
    oidcIssuer: text("oidc_issuer"),
    oidcSubject: text("oidc_subject"),
    oidcSid: text("oidc_sid"),
    oidcIdToken: text("oidc_id_token"),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expiresIdx: index("sessions_expires_idx").on(t.expiresAt),
    oidcSidIdx: index("sessions_oidc_sid_idx").on(t.oidcSid),
    oidcIdentityIdx: index("sessions_oidc_identity_idx").on(t.oidcIssuer, t.oidcSubject),
  }),
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
