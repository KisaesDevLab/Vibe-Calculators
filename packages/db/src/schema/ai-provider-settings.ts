import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Phase 23.4 — AI provider settings (UI-managed config).
 *
 * Singleton row (id = 'singleton'). Migration seeds the row so
 * GET always returns 200. The DB takes precedence over .env once any
 * field is populated; missing fields fall back to .env.
 *
 * API keys are KMS-sealed via the apps/api KmsClient (AES-GCM
 * envelope encryption) before insert. The route never echoes the
 * plaintext back — only a 4-char prefix for "yes the right one is
 * loaded" UX.
 */

export const AI_PROVIDER_SETTINGS_ID = "singleton" as const;

export const aiProviderSettings = pgTable("ai_provider_settings", {
  id: text("id").primaryKey().default(AI_PROVIDER_SETTINGS_ID),
  /** 'anthropic' | 'local' | null. Null = use .env / no provider. */
  activeProvider: text("active_provider"),
  /** AES-GCM-sealed Anthropic API key. */
  anthropicApiKeySealed: text("anthropic_api_key_sealed"),
  anthropicDefaultModel: text("anthropic_default_model"),
  /** Base URL of an OpenAI-wire-format gateway (e.g. http://vibe-llm:8080/v1). */
  localBaseUrl: text("local_base_url"),
  localDefaultModel: text("local_default_model"),
  /** Optional bearer token for the local gateway, KMS-sealed. */
  localApiKeySealed: text("local_api_key_sealed"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type AiProviderSettingsRow = typeof aiProviderSettings.$inferSelect;
export type NewAiProviderSettingsRow = typeof aiProviderSettings.$inferInsert;
