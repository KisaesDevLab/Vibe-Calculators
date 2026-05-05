-- Phase 23.17 — versioned AI prompt store.

CREATE TABLE "ai_prompts" (
  "id"             text PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"           text NOT NULL,
  "version"        integer NOT NULL,
  "body"           text NOT NULL,
  "system_message" text,
  "notes"          text,
  "active"         boolean NOT NULL DEFAULT false,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"     text REFERENCES "users"("id") ON DELETE SET NULL,
  "archived_at"    timestamp with time zone
);

CREATE INDEX "ai_prompts_kind_version_idx" ON "ai_prompts" ("kind", "version");
CREATE INDEX "ai_prompts_active_idx" ON "ai_prompts" ("kind", "active");
