-- Phase 24 — api_keys + webhook_subscriptions.

CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "token_hash" text NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '[]',
  "issued_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "act_as_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX "api_keys_prefix_idx" ON "api_keys" ("prefix");
--> statement-breakpoint
CREATE INDEX "api_keys_issued_by_idx" ON "api_keys" ("issued_by");
--> statement-breakpoint
CREATE INDEX "api_keys_revoked_idx" ON "api_keys" ("revoked_at");
--> statement-breakpoint

CREATE TABLE "webhook_subscriptions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "actions" jsonb NOT NULL DEFAULT '[]',
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz,
  "last_fired_at" timestamptz,
  "last_failure_message" text
);
--> statement-breakpoint

CREATE INDEX "webhook_subs_archived_idx" ON "webhook_subscriptions" ("archived_at");
