-- Single sign-on via @kisaesdevlab/vibe-auth.
--
-- 1. The package's three tables (verbatim from its sql/auth_identities.sql;
--    user_id is TEXT, which matches users.id here).
-- 2. OIDC columns on sessions, so RP-initiated logout can pass the
--    id_token_hint and back-channel logout can find the rows to revoke.
--    All four are NULL for password / magic-link / break-glass sessions.
--    oidc_id_token is sealed with VIBE_KMS_KEY by the application.
-- 3. auth_event_kind values for the package's audit vocabulary; the events
--    join the same tamper-evident auth_events chain as local logins.

CREATE TABLE IF NOT EXISTS auth_identities (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  issuer          TEXT NOT NULL,
  subject         TEXT NOT NULL,
  email           TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_issuer_subject_uq UNIQUE (issuer, subject)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx ON auth_identities (user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth_revocations (
  subject_key    TEXT PRIMARY KEY,
  revoked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_until  TIMESTAMPTZ NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_revocations_until_idx ON auth_revocations (revoked_until);
--> statement-breakpoint

ALTER TABLE "sessions"
  ADD COLUMN "oidc_issuer" text,
  ADD COLUMN "oidc_subject" text,
  ADD COLUMN "oidc_sid" text,
  ADD COLUMN "oidc_id_token" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_oidc_sid_idx" ON "sessions" ("oidc_sid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_oidc_identity_idx" ON "sessions" ("oidc_issuer", "oidc_subject");
--> statement-breakpoint

ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.login.success';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.login.failure';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.user.provisioned';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.user.linked';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.role.changed';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.logout';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.mode.changed';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.breakglass.used';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.breakglass.rotated';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.idp.unreachable';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.settings.changed';
--> statement-breakpoint
ALTER TYPE "auth_event_kind" ADD VALUE IF NOT EXISTS 'vibe.auth.mfa.enforcement.disabled';
