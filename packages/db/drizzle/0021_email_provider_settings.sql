-- Phase 25.x follow-up — email provider settings (UI-managed config).
--
-- Mirror of ai_provider_settings (Phase 23.4): a singleton row whose
-- DB-backed config takes precedence over .env. Per-provider secrets
-- (SMTP password, Postmark token, EmailIt API key) are KMS-sealed
-- before insert via apps/api KmsClient. The admin UI (PUT) never
-- echoes plaintext back — only a 4-char prefix.

CREATE TABLE "email_provider_settings" (
  "id"                       text PRIMARY KEY DEFAULT 'singleton',
  "active_provider"          text,
  -- SMTP block
  "smtp_host"                text,
  "smtp_port"                integer,
  "smtp_user"                text,
  "smtp_pass_sealed"         text,
  "smtp_secure"              boolean NOT NULL DEFAULT false,
  "smtp_from"                text,
  -- Postmark block
  "postmark_token_sealed"    text,
  "postmark_from"            text,
  "postmark_stream"          text,
  -- EmailIt block
  "emailit_key_sealed"       text,
  "emailit_from"             text,
  "emailit_endpoint"         text,
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"               text REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "email_provider_settings_singleton_chk" CHECK ("id" = 'singleton'),
  CONSTRAINT "email_provider_settings_provider_chk"
    CHECK ("active_provider" IS NULL OR "active_provider" IN ('smtp', 'postmark', 'emailit'))
);

INSERT INTO "email_provider_settings" ("id") VALUES ('singleton');
