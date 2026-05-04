-- Phase 21.3 — domain audit_events (tamper-evident chain) + calculation_comments.

CREATE TYPE "public"."audit_action" AS ENUM (
  'calculation.create',
  'calculation.save',
  'calculation.submit_for_review',
  'calculation.approve',
  'calculation.reject',
  'calculation.rollback',
  'calculation.archive',
  'calculation.restore',
  'calculation.comment',
  'calculation.lock',
  'engagement.create',
  'engagement.transition',
  'engagement.assign',
  'engagement.archive',
  'engagement.restore',
  'client.create',
  'client.update',
  'client.archive',
  'client.restore',
  'tag.attach',
  'tag.detach',
  'bulk.archive',
  'bulk.reassign',
  'bulk.change_tax_year',
  'export.created',
  'export.downloaded'
);
--> statement-breakpoint

CREATE TYPE "public"."audit_entity_kind" AS ENUM (
  'client',
  'engagement',
  'calculation',
  'calculation_version',
  'tag',
  'user'
);
--> statement-breakpoint

CREATE TABLE "audit_events" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "action" audit_action NOT NULL,
  "entity_kind" audit_entity_kind NOT NULL,
  "entity_id" text NOT NULL,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "prev_hash" text NOT NULL,
  "row_hash" text NOT NULL
);
--> statement-breakpoint

CREATE INDEX "audit_events_created_at_idx" ON "audit_events" ("created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" ("entity_kind", "entity_id");
--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" ("action");
--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" ("actor_user_id");
--> statement-breakpoint

CREATE TABLE "calculation_comments" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "calculation_id" text NOT NULL,
  "version_id" text,
  "author_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "kind" text NOT NULL DEFAULT 'note'
);
--> statement-breakpoint

CREATE INDEX "calc_comments_calc_idx" ON "calculation_comments" ("calculation_id");
--> statement-breakpoint
CREATE INDEX "calc_comments_version_idx" ON "calculation_comments" ("version_id");
--> statement-breakpoint
CREATE INDEX "calc_comments_author_idx" ON "calculation_comments" ("author_id");
