import { eq } from "drizzle-orm";
import {
  emailProviderSettings,
  EMAIL_PROVIDER_SETTINGS_ID,
  type EmailProviderSettingsRow,
  type Database,
} from "@vibe-calc/db";
import {
  createEmailProvider,
  createEmailProviderFromEnv,
  type EmailProvider,
  type ProviderName,
} from "@vibe-calc/email";
import type { KmsClient } from "./kms.js";
import { logger } from "./logger.js";

/**
 * Email provider resolver — DB takes precedence over .env.
 *
 * Mirrors the AI provider resolver (Phase 23.4): every send call
 * resolves freshly so admin updates take effect without a server
 * restart. The factory throws on incomplete configs (e.g. SMTP_HOST
 * blank) — we swallow that here and fall back to env / null so a
 * partial config doesn't 500 every magic-link send.
 */

export interface EmailResolverEnv {
  VIBE_EMAIL_PROVIDER?: string | undefined;
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: string | undefined;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  SMTP_SECURE?: string | undefined;
  SMTP_FROM?: string | undefined;
  POSTMARK_SERVER_TOKEN?: string | undefined;
  POSTMARK_FROM?: string | undefined;
  POSTMARK_STREAM?: string | undefined;
  EMAILIT_API_KEY?: string | undefined;
  EMAILIT_FROM?: string | undefined;
  EMAILIT_ENDPOINT?: string | undefined;
}

export interface ResolvedEmailProvider {
  provider: EmailProvider;
  source: "db" | "env";
  providerName: ProviderName;
}

/**
 * Caller-facing convenience type. Send call sites take this in their
 * deps and invoke it per send so admin updates take effect without a
 * server restart.
 */
export type ResolveEmailProvider = () => Promise<EmailProvider | null>;

export async function getEmailProviderSettings(db: Database): Promise<EmailProviderSettingsRow> {
  const [existing] = await db
    .select()
    .from(emailProviderSettings)
    .where(eq(emailProviderSettings.id, EMAIL_PROVIDER_SETTINGS_ID))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(emailProviderSettings)
    .values({ id: EMAIL_PROVIDER_SETTINGS_ID })
    .onConflictDoNothing({ target: emailProviderSettings.id })
    .returning();
  if (created) return created;
  const [retry] = await db
    .select()
    .from(emailProviderSettings)
    .where(eq(emailProviderSettings.id, EMAIL_PROVIDER_SETTINGS_ID))
    .limit(1);
  if (!retry) {
    throw new Error("email_provider_settings singleton missing and could not be created");
  }
  return retry;
}

export async function resolveEmailProvider(
  db: Database,
  kms: KmsClient,
  env: EmailResolverEnv,
): Promise<ResolvedEmailProvider | null> {
  const settings = await getEmailProviderSettings(db);

  if (settings.activeProvider === "smtp") {
    const built = buildSmtpFromDb(settings, kms);
    if (built) return { provider: built, source: "db", providerName: "smtp" };
  }
  if (settings.activeProvider === "postmark") {
    const built = buildPostmarkFromDb(settings, kms);
    if (built) return { provider: built, source: "db", providerName: "postmark" };
  }
  if (settings.activeProvider === "emailit") {
    const built = buildEmailItFromDb(settings, kms);
    if (built) return { provider: built, source: "db", providerName: "emailit" };
  }

  return resolveFromEnv(env);
}

/**
 * Cheap "what's configured" probe — no KMS decrypt, no transport build.
 * Used at boot to log the active provider without paying the per-send cost.
 */
export async function peekEmailProviderName(
  db: Database,
  env: EmailResolverEnv,
): Promise<{ source: "db" | "env"; providerName: ProviderName } | null> {
  const settings = await getEmailProviderSettings(db);
  if (
    settings.activeProvider === "smtp" ||
    settings.activeProvider === "postmark" ||
    settings.activeProvider === "emailit"
  ) {
    return { source: "db", providerName: settings.activeProvider };
  }
  const envName = env.VIBE_EMAIL_PROVIDER;
  if (envName === "smtp" || envName === "postmark" || envName === "emailit") {
    return { source: "env", providerName: envName };
  }
  return null;
}

function buildSmtpFromDb(s: EmailProviderSettingsRow, kms: KmsClient): EmailProvider | null {
  if (!s.smtpHost || !s.smtpPort || !s.smtpUser || !s.smtpPassSealed || !s.smtpFrom) {
    return null;
  }
  let pass: string;
  try {
    pass = kms.decrypt(s.smtpPassSealed);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to decrypt SMTP password from DB; falling back to env",
    );
    return null;
  }
  try {
    return createEmailProvider({
      provider: "smtp",
      smtp: {
        host: s.smtpHost,
        port: s.smtpPort,
        user: s.smtpUser,
        pass,
        secure: s.smtpSecure,
        from: s.smtpFrom,
      },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "smtp DB config invalid; falling back to env",
    );
    return null;
  }
}

function buildPostmarkFromDb(s: EmailProviderSettingsRow, kms: KmsClient): EmailProvider | null {
  if (!s.postmarkTokenSealed || !s.postmarkFrom) return null;
  let serverToken: string;
  try {
    serverToken = kms.decrypt(s.postmarkTokenSealed);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to decrypt Postmark token from DB; falling back to env",
    );
    return null;
  }
  try {
    return createEmailProvider({
      provider: "postmark",
      postmark: {
        serverToken,
        from: s.postmarkFrom,
        ...(s.postmarkStream ? { messageStream: s.postmarkStream } : {}),
      },
    });
  } catch {
    return null;
  }
}

function buildEmailItFromDb(s: EmailProviderSettingsRow, kms: KmsClient): EmailProvider | null {
  if (!s.emailitKeySealed || !s.emailitFrom) return null;
  let apiKey: string;
  try {
    apiKey = kms.decrypt(s.emailitKeySealed);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to decrypt EmailIt API key from DB; falling back to env",
    );
    return null;
  }
  try {
    return createEmailProvider({
      provider: "emailit",
      emailit: {
        apiKey,
        from: s.emailitFrom,
        ...(s.emailitEndpoint ? { endpoint: s.emailitEndpoint } : {}),
      },
    });
  } catch {
    return null;
  }
}

function resolveFromEnv(env: EmailResolverEnv): ResolvedEmailProvider | null {
  const name = env.VIBE_EMAIL_PROVIDER ?? "smtp";
  if (name !== "smtp" && name !== "postmark" && name !== "emailit") return null;
  try {
    return {
      provider: createEmailProviderFromEnv(env as Record<string, string | undefined>),
      source: "env",
      providerName: name,
    };
  } catch {
    return null;
  }
}

export function readEmailEnv(): EmailResolverEnv {
  return {
    VIBE_EMAIL_PROVIDER: process.env.VIBE_EMAIL_PROVIDER,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_FROM: process.env.SMTP_FROM,
    POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN,
    POSTMARK_FROM: process.env.POSTMARK_FROM,
    POSTMARK_STREAM: process.env.POSTMARK_STREAM,
    EMAILIT_API_KEY: process.env.EMAILIT_API_KEY,
    EMAILIT_FROM: process.env.EMAILIT_FROM,
    EMAILIT_ENDPOINT: process.env.EMAILIT_ENDPOINT,
  };
}
