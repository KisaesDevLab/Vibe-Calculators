-- Phase 22.4 — schedules + schedule_instances.

CREATE TYPE "public"."schedule_cadence" AS ENUM (
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annually',
  'once'
);
--> statement-breakpoint

CREATE TYPE "public"."schedule_status" AS ENUM (
  'active',
  'paused',
  'completed',
  'failed'
);
--> statement-breakpoint

CREATE TYPE "public"."schedule_instance_status" AS ENUM (
  'queued',
  'running',
  'delivered',
  'failed'
);
--> statement-breakpoint

CREATE TABLE "schedules" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "calculation_id" text NOT NULL REFERENCES "calculations"("id") ON DELETE CASCADE,
  "cadence" schedule_cadence NOT NULL,
  "send_at" text NOT NULL DEFAULT '09:00',
  "next_run_at" timestamptz NOT NULL,
  "recipients" text NOT NULL,
  "subject" text NOT NULL,
  "body" text,
  "status" schedule_status NOT NULL DEFAULT 'active',
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX "schedules_calc_idx" ON "schedules" ("calculation_id");
--> statement-breakpoint
CREATE INDEX "schedules_next_run_idx" ON "schedules" ("next_run_at");
--> statement-breakpoint
CREATE INDEX "schedules_status_idx" ON "schedules" ("status");
--> statement-breakpoint

CREATE TABLE "schedule_instances" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" text NOT NULL REFERENCES "schedules"("id") ON DELETE CASCADE,
  "run_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "status" schedule_instance_status NOT NULL DEFAULT 'queued',
  "delivery_details" jsonb NOT NULL DEFAULT '{}',
  "outputs_snapshot" jsonb NOT NULL DEFAULT '{}',
  "attempts" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE INDEX "schedule_instances_schedule_idx" ON "schedule_instances" ("schedule_id");
--> statement-breakpoint
CREATE INDEX "schedule_instances_run_at_idx" ON "schedule_instances" ("run_at");
--> statement-breakpoint
CREATE INDEX "schedule_instances_status_idx" ON "schedule_instances" ("status");
