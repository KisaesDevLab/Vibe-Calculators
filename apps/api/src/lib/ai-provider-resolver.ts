import { eq } from "drizzle-orm";
import {
  aiProviderSettings,
  AI_PROVIDER_SETTINGS_ID,
  type AiProviderSettingsRow,
  type Database,
} from "@vibe-calc/db";
import { AnthropicProvider, LocalProvider, type LlmProvider } from "@vibe-calc/llm";
import type { KmsClient } from "./kms.js";
import { logger } from "./logger.js";

/**
 * Phase 23.4 — AI provider resolver.
 *
 * Routes call this per-request so admin updates take effect without
 * a server restart. Resolution order:
 *
 *   1. ai_provider_settings row, if active_provider is set and the
 *      relevant fields are populated.
 *   2. Environment fallback (ANTHROPIC_API_KEY / VIBE_LLM_LOCAL_URL).
 *
 * `VIBE_OFFLINE=true` still forces local-only at the env layer; if
 * the DB selects 'anthropic' under offline mode, the resolver
 * falls through to local-from-env (operator's offline policy wins).
 */

export interface ResolverEnv {
  ANTHROPIC_API_KEY?: string | undefined;
  VIBE_LLM_DEFAULT_MODEL?: string | undefined;
  VIBE_LLM_PROVIDER?: string | undefined;
  VIBE_LLM_LOCAL_URL?: string | undefined;
  VIBE_LLM_LOCAL_MODEL?: string | undefined;
  VIBE_LLM_LOCAL_API_KEY?: string | undefined;
  VIBE_OFFLINE?: boolean | undefined;
  VIBE_DEPLOY_MODE?: string | undefined;
}

export interface ResolvedProvider {
  provider: LlmProvider;
  source: "db" | "env";
  /** Provider name surfaced to UI / logs. */
  providerName: "anthropic" | "local";
  /** Resolved default model (DB > env > provider default). */
  defaultModel: string | null;
}

/** Read the singleton settings row (creating it lazily if missing). */
export async function getAiProviderSettings(db: Database): Promise<AiProviderSettingsRow> {
  const [existing] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.id, AI_PROVIDER_SETTINGS_ID))
    .limit(1);
  if (existing) return existing;
  // The migration seeds this row, but a fresh test DB or a manual
  // DELETE would leave it empty. Insert-or-return defends both.
  const [created] = await db
    .insert(aiProviderSettings)
    .values({ id: AI_PROVIDER_SETTINGS_ID })
    .onConflictDoNothing({ target: aiProviderSettings.id })
    .returning();
  if (created) return created;
  // onConflictDoNothing returned no row — re-read.
  const [retry] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.id, AI_PROVIDER_SETTINGS_ID))
    .limit(1);
  if (!retry) {
    throw new Error("ai_provider_settings singleton missing and could not be created");
  }
  return retry;
}

export async function resolveLlmProvider(
  db: Database,
  kms: KmsClient,
  env: ResolverEnv,
): Promise<ResolvedProvider | null> {
  const settings = await getAiProviderSettings(db);
  const offline = env.VIBE_OFFLINE === true;

  // 1. DB-driven config wins, BUT under offline mode the only valid
  //    DB selection is 'local' — anything else falls through to env.
  if (settings.activeProvider === "anthropic" && !offline) {
    if (settings.anthropicApiKeySealed) {
      try {
        const apiKey = kms.decrypt(settings.anthropicApiKeySealed);
        return {
          provider: new AnthropicProvider({
            apiKey,
            defaultModel: settings.anthropicDefaultModel ?? undefined,
          }),
          source: "db",
          providerName: "anthropic",
          defaultModel: settings.anthropicDefaultModel ?? null,
        };
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "failed to decrypt anthropic API key from DB; falling back to env",
        );
      }
    }
  }
  if (settings.activeProvider === "local") {
    if (settings.localBaseUrl && isSafeLocalLlmUrl(settings.localBaseUrl)) {
      let localApiKey: string | undefined;
      if (settings.localApiKeySealed) {
        try {
          localApiKey = kms.decrypt(settings.localApiKeySealed);
        } catch {
          // ignore — auth optional for self-hosted gateways
        }
      }
      return {
        provider: new LocalProvider({
          baseUrl: settings.localBaseUrl,
          defaultModel: settings.localDefaultModel ?? undefined,
          apiKey: localApiKey,
        }),
        source: "db",
        providerName: "local",
        defaultModel: settings.localDefaultModel ?? null,
      };
    }
  }

  // 2. Environment fallback (the original boot-time selection logic).
  return resolveFromEnv(env);
}

function resolveFromEnv(env: ResolverEnv): ResolvedProvider | null {
  const offline = env.VIBE_OFFLINE === true;
  const explicit = (env.VIBE_LLM_PROVIDER ?? "").toLowerCase();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const localUrl = env.VIBE_LLM_LOCAL_URL?.trim();
  const wantAnthropic =
    !offline && (explicit === "anthropic" || (!explicit && Boolean(anthropicKey)));
  const wantLocal =
    explicit === "local" ||
    (offline && Boolean(localUrl)) ||
    (!explicit && !anthropicKey && Boolean(localUrl));
  if (wantAnthropic && anthropicKey) {
    return {
      provider: new AnthropicProvider({
        apiKey: anthropicKey,
        defaultModel: env.VIBE_LLM_DEFAULT_MODEL ?? undefined,
      }),
      source: "env",
      providerName: "anthropic",
      defaultModel: env.VIBE_LLM_DEFAULT_MODEL ?? null,
    };
  }
  if (wantLocal && localUrl && isSafeLocalLlmUrl(localUrl)) {
    return {
      provider: new LocalProvider({
        baseUrl: localUrl,
        defaultModel: env.VIBE_LLM_LOCAL_MODEL ?? env.VIBE_LLM_DEFAULT_MODEL ?? undefined,
        apiKey: env.VIBE_LLM_LOCAL_API_KEY ?? undefined,
      }),
      source: "env",
      providerName: "local",
      defaultModel: env.VIBE_LLM_LOCAL_MODEL ?? env.VIBE_LLM_DEFAULT_MODEL ?? null,
    };
  }
  return null;
}

/**
 * SSRF guard — duplicated from apps/api/src/index.ts so the resolver
 * is self-contained. Cloud-metadata oracles always blocked; plain
 * hostnames + private IPs allowed (the appliance is self-hosted).
 */
function isSafeLocalLlmUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (!host) return false;
  const META_BLACKLIST = ["169.254.169.254", "metadata.google.internal", "metadata"];
  if (META_BLACKLIST.includes(host)) return false;
  return true;
}

/**
 * Curated list of well-known model IDs for each provider. The UI
 * shows these in a dropdown; the operator can also enter a custom
 * string. Update this list as new models ship.
 */
export const KNOWN_MODELS = {
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7 (highest capability)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (default — balanced)" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, lowest cost)" },
    { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet (legacy)" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (legacy)" },
  ],
  local: [
    { id: "qwen3-8b", label: "Qwen3 8B (default — vibe-llm-server)" },
    { id: "qwen3-32b", label: "Qwen3 32B (higher quality, slower)" },
    { id: "llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct" },
    { id: "llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
    { id: "mistral-7b-instruct-v0.3", label: "Mistral 7B Instruct" },
  ],
} as const;
