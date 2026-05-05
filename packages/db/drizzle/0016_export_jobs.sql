-- Phase 13.7 — async export queue.
--
-- One row per queued export. The queue itself lives in Redis (BullMQ);
-- this table is the durable status store the UI polls and the
-- retention sweep walks for expired files.

CREATE TYPE "export_job_kind" AS ENUM (
  'tvm-pdf',
  'memo-pdf',
  'xlsx',
  'csv',
  'docx',
  'bulk-zip'
);

CREATE TYPE "export_job_status" AS ENUM (
  'queued',
  'processing',
  'done',
  'failed'
);

CREATE TABLE "export_jobs" (
  "id"              text PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"            export_job_kind NOT NULL,
  "status"          export_job_status NOT NULL DEFAULT 'queued',
  "calculation_id"  text REFERENCES "calculations"("id") ON DELETE SET NULL,
  "calculation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "options"         jsonb DEFAULT '{}'::jsonb NOT NULL,
  "filename"        text,
  "file_path"       text,
  "size_bytes"      integer,
  "progress"        integer NOT NULL DEFAULT 0,
  "error_message"   text,
  "requested_by"    text REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "started_at"      timestamp with time zone,
  "completed_at"    timestamp with time zone,
  "expires_at"      timestamp with time zone
);

CREATE INDEX "export_jobs_status_idx"      ON "export_jobs" ("status");
CREATE INDEX "export_jobs_requested_by_idx" ON "export_jobs" ("requested_by", "requested_at" DESC);
CREATE INDEX "export_jobs_expires_at_idx"  ON "export_jobs" ("expires_at");
