-- Phase 22.7 — per-user email digest preference.
--
-- Three settings: immediate / daily / off.
-- Account-recovery + magic-link emails always send regardless.

ALTER TABLE "users"
  ADD COLUMN "email_digest" text NOT NULL DEFAULT 'immediate';

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_digest_check"
  CHECK ("email_digest" IN ('immediate', 'daily', 'off'));
