-- Phase 24.5 / 24.6 — webhook delivery durable status + per-key rate limit.
--
-- webhook_deliveries: one row per (subscription, event) attempt
-- chain. The retry queue (BullMQ) carries the in-flight retries;
-- this table is the durable status the UI / admin tools can query.
-- attempts ladder is exponential 5/15/60/300/1800s (Phase 24.5);
-- after attempts >= 5 the row goes status='dead' and is excluded
-- from further dispatch.

CREATE TYPE "webhook_delivery_status" AS ENUM (
  'pending',
  'delivered',
  'retrying',
  'dead'
);

CREATE TABLE "webhook_deliveries" (
  "id"                   text PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscription_id"      text NOT NULL REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE,
  "action"               text NOT NULL,
  "entity_kind"          text NOT NULL,
  "entity_id"            text NOT NULL,
  "body"                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempts"             integer NOT NULL DEFAULT 0,
  "status"               webhook_delivery_status NOT NULL DEFAULT 'pending',
  "last_failure_message" text,
  "last_attempt_at"      timestamp with time zone,
  "delivered_at"         timestamp with time zone,
  "dead_at"              timestamp with time zone,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "webhook_deliveries_subscription_idx"
  ON "webhook_deliveries" ("subscription_id", "created_at" DESC);
CREATE INDEX "webhook_deliveries_status_idx"
  ON "webhook_deliveries" ("status");
CREATE INDEX "webhook_deliveries_dead_idx"
  ON "webhook_deliveries" ("dead_at") WHERE "status" = 'dead';

-- Phase 24.6 — per-key rate limit override. NULL = use the global
-- default (60 req/min). Operators can scale up automation keys
-- without raising the global ceiling.
ALTER TABLE "api_keys"
  ADD COLUMN "rate_limit_per_min" integer;
