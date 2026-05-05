-- Phase 25.4 — firm_settings (single-row).
--
-- Captured by the first-run setup wizard; surfaces firm name +
-- branding into PDF exports (Phase 13.3). Single row keyed by
-- id='singleton' so no concurrency-modeling is needed.

CREATE TABLE "firm_settings" (
  "id"             text          PRIMARY KEY DEFAULT 'singleton',
  "firm_name"      text          NOT NULL DEFAULT '',
  "firm_ein"       text,
  "firm_address"   text,
  "firm_phone"     text,
  "pdf_footer"     text,
  "brand_color"    text,
  "logo_data_url"  text,
  "timezone"       text          NOT NULL DEFAULT 'America/Chicago',
  "extra"          jsonb         DEFAULT '{}'::jsonb,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"     text
);

-- Pre-seed the singleton row so reads always return a value (even
-- if the operator skipped the setup wizard's branding step).
INSERT INTO "firm_settings" (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;
