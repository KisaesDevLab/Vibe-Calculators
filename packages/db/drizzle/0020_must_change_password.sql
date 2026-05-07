-- Phase 25.3 (revised) — default-admin install path.
--
-- Replaces the bootstrap-token install ceremony with a seeded
-- admin@local user whose default password the operator must change
-- on first login. This column tracks that pending state: the login
-- response carries it, the SPA redirects to /onboarding/change-password
-- whenever it is true, and POST /api/v1/me/password clears it.

ALTER TABLE "users"
  ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false;
