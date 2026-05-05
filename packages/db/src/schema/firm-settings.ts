import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Phase 25.4 — firm-wide settings (single row).
 *
 * Captured by the first-run setup wizard, displayed in PDF headers
 * (Phase 13.3), and editable from the admin UI later. There is
 * exactly one row, identified by id="singleton". The row exists
 * for the lifetime of the appliance; updates are in-place.
 *
 * Logo is stored as a base64-encoded data URL (≤1 MB enforced
 * application-side). Persisting in the row keeps backups
 * self-contained without a sidecar bucket.
 */
export const firmSettings = pgTable("firm_settings", {
  id: text("id").primaryKey().default("singleton"),
  firmName: text("firm_name").notNull().default(""),
  firmEin: text("firm_ein"),
  firmAddress: text("firm_address"),
  firmPhone: text("firm_phone"),
  /** PDF footer disclaimer (rendered on every export). */
  pdfFooter: text("pdf_footer"),
  /** Optional brand color hex (e.g. "#2563eb"). */
  brandColor: text("brand_color"),
  /** Logo as data URL (data:image/png;base64,...). Capped at 1 MB. */
  logoDataUrl: text("logo_data_url"),
  /** Firm time zone — IANA name. Default America/Chicago for MVP. */
  timezone: text("timezone").notNull().default("America/Chicago"),
  /** Free-form admin-controlled JSON for future fields without a migration. */
  extra: jsonb("extra").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export type FirmSettingsRow = typeof firmSettings.$inferSelect;
export type NewFirmSettingsRow = typeof firmSettings.$inferInsert;

export const FIRM_SETTINGS_ID = "singleton" as const;
