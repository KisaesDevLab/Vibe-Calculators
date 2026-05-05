-- Phase 23.4 — AI provider settings (DB-backed config that overrides
-- the .env fallback). Singleton row, KMS-sealed API keys.

CREATE TABLE "ai_provider_settings" (
  "id"                            text PRIMARY KEY DEFAULT 'singleton',
  "active_provider"               text,
  "anthropic_api_key_sealed"      text,
  "anthropic_default_model"       text,
  "local_base_url"                text,
  "local_default_model"           text,
  "local_api_key_sealed"          text,
  "updated_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"                    text REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "ai_provider_settings_singleton_chk" CHECK ("id" = 'singleton'),
  CONSTRAINT "ai_provider_settings_provider_chk"
    CHECK ("active_provider" IS NULL OR "active_provider" IN ('anthropic', 'local'))
);

INSERT INTO "ai_provider_settings" ("id") VALUES ('singleton');
