import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Email provider settings (UI-managed config).
 *
 * Singleton row (id = 'singleton'). Migration seeds the row so GET
 * always returns 200. The DB takes precedence over .env once any
 * field is populated; missing fields fall back to .env.
 *
 * Secret fields (SMTP password, Postmark token, EmailIt API key) are
 * KMS-sealed via the apps/api KmsClient (AES-GCM envelope encryption)
 * before insert. The admin route never echoes plaintext back — only
 * a 4-char prefix for "yes the right one is loaded" UX.
 */

export const EMAIL_PROVIDER_SETTINGS_ID = "singleton" as const;

export const emailProviderSettings = pgTable("email_provider_settings", {
  id: text("id").primaryKey().default(EMAIL_PROVIDER_SETTINGS_ID),
  /** 'smtp' | 'postmark' | 'emailit' | null. Null = use .env / no provider. */
  activeProvider: text("active_provider"),
  // SMTP
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassSealed: text("smtp_pass_sealed"),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpFrom: text("smtp_from"),
  // Postmark
  postmarkTokenSealed: text("postmark_token_sealed"),
  postmarkFrom: text("postmark_from"),
  postmarkStream: text("postmark_stream"),
  // EmailIt
  emailitKeySealed: text("emailit_key_sealed"),
  emailitFrom: text("emailit_from"),
  emailitEndpoint: text("emailit_endpoint"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type EmailProviderSettingsRow = typeof emailProviderSettings.$inferSelect;
export type NewEmailProviderSettingsRow = typeof emailProviderSettings.$inferInsert;
