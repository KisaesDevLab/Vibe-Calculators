import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 24.2 — per-firm API keys.
 *
 * Tokens are stored as SHA-256 hashes; the plaintext is shown to
 * the admin once at issuance. The `prefix` column stores the
 * first 8 characters of the plaintext (after `vibe_`) so admins
 * can identify a key in the UI without revealing the secret.
 *
 * `scopes` is the optional permission allowlist; an empty array
 * means "every permission the issuer has". The middleware narrows
 * the request user to those scopes.
 */

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Human-friendly name (e.g. "GitHub Actions"). */
    name: text("name").notNull(),
    /** Public 8-char prefix shown in UI (after `vibe_`). */
    prefix: text("prefix").notNull(),
    /** SHA-256 of the full plaintext token. */
    tokenHash: text("token_hash").notNull(),
    /** Optional scope list (subset of permission strings). */
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    issuedBy: text("issued_by").references(() => users.id, { onDelete: "set null" }),
    /** Optional act-as user — required for endpoints that need a user context. */
    actAsUserId: text("act_as_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    prefixIdx: index("api_keys_prefix_idx").on(t.prefix),
    issuedByIdx: index("api_keys_issued_by_idx").on(t.issuedBy),
    revokedIdx: index("api_keys_revoked_idx").on(t.revokedAt),
  }),
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

/**
 * Webhooks — outbound notifications keyed by an audit-action filter.
 */
export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** HMAC secret for X-Vibe-Signature. */
    secret: text("secret").notNull(),
    /** Action filter — empty array means "every action". */
    actions: jsonb("actions").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastFailureMessage: text("last_failure_message"),
  },
  (t) => ({
    archivedIdx: index("webhook_subs_archived_idx").on(t.archivedAt),
  }),
);

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;
export type NewWebhookSubscriptionRow = typeof webhookSubscriptions.$inferInsert;
