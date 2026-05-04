-- Phase 3.6 — full-text search across the user-facing entities.
--
-- A generated tsvector column on each table indexes the searchable
-- columns; a GIN index makes the search cheap. We use the english
-- config — Phase 22 may add per-locale variants once the firm-locale
-- field lands.
--
-- For calculations.inputs_json we cast the jsonb to text so the
-- raw fields (loan_amount, rate, etc) are searchable. This is
-- intentionally crude — Phase 20 may add structured filters.

ALTER TABLE "clients"
  ADD COLUMN "search_doc" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(ein, ''))) STORED;
--> statement-breakpoint

ALTER TABLE "engagements"
  ADD COLUMN "search_doc" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, ''))) STORED;
--> statement-breakpoint

ALTER TABLE "calculations"
  ADD COLUMN "search_doc" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(inputs_json::text, '')
    )
  ) STORED;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clients_search_doc_idx" ON "clients" USING GIN ("search_doc");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_search_doc_idx" ON "engagements" USING GIN ("search_doc");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_search_doc_idx" ON "calculations" USING GIN ("search_doc");
--> statement-breakpoint

-- Phase 3.9 — DB-level CHECK constraints.
--
-- Drizzle's pgEnum already enforces the role/status sets at the type
-- system level; these CHECKs add belt-and-suspenders enforcement at
-- the DB layer for shapes that aren't covered by enums:
--
--   * users.email must contain '@' and be lowercase (matches the
--     application contract that callers normalize before insert)
--   * clients.ein, when present, matches \d{2}-\d{7} (US EIN format)
--   * tax_year, when present, in [1900, 2200] — defends against typos
--     like '202' or '20245'
--   * calculation.version >= 1

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_format" CHECK (position('@' in email) > 1 AND email = lower(email));
--> statement-breakpoint
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_ein_format" CHECK (ein IS NULL OR ein ~ '^[0-9]{2}-[0-9]{7}$');
--> statement-breakpoint
ALTER TABLE "engagements"
  ADD CONSTRAINT "engagements_tax_year_range" CHECK (tax_year IS NULL OR (tax_year BETWEEN 1900 AND 2200));
--> statement-breakpoint
ALTER TABLE "calculations"
  ADD CONSTRAINT "calculations_version_positive" CHECK (version >= 1);
--> statement-breakpoint
ALTER TABLE "calculation_versions"
  ADD CONSTRAINT "calc_versions_version_positive" CHECK (version >= 1);
