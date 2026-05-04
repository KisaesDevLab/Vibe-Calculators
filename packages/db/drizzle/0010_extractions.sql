-- Phase 23 — extraction_jobs.

CREATE TYPE "public"."extraction_status" AS ENUM (
  'pending',
  'processing',
  'needs_review',
  'approved',
  'failed'
);
--> statement-breakpoint

CREATE TABLE "extraction_jobs" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" text REFERENCES "clients"("id") ON DELETE SET NULL,
  "engagement_id" text REFERENCES "engagements"("id") ON DELETE SET NULL,
  "source_filename" text NOT NULL,
  "document_text" text NOT NULL,
  "status" extraction_status NOT NULL DEFAULT 'pending',
  "extracted_json" jsonb DEFAULT '{}',
  "field_confidence" jsonb DEFAULT '{}',
  "provider_response_id" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "error_message" text,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "reviewed_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX "extraction_jobs_status_idx" ON "extraction_jobs" ("status");
--> statement-breakpoint
CREATE INDEX "extraction_jobs_client_idx" ON "extraction_jobs" ("client_id");
--> statement-breakpoint
CREATE INDEX "extraction_jobs_engagement_idx" ON "extraction_jobs" ("engagement_id");
--> statement-breakpoint
CREATE INDEX "extraction_jobs_created_by_idx" ON "extraction_jobs" ("created_by");
