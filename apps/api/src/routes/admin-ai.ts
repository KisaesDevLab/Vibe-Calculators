import { Router, type Request, type Response } from "express";
import { desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { LlmProvider } from "@vibe-calc/llm";
import {
  aiProviderSettings,
  AI_PROVIDER_SETTINGS_ID,
  extractionJobs,
  users,
  type Database,
} from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import {
  getAiProviderSettings,
  resolveLlmProvider,
  KNOWN_MODELS,
  type ResolverEnv,
} from "../lib/ai-provider-resolver.js";
import type { KmsClient } from "../lib/kms.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 23.4 — AI provider config + status + test.
 *
 *   GET  /api/v1/admin/ai                      — provider status
 *   GET  /api/v1/admin/ai/settings             — current DB config
 *   PUT  /api/v1/admin/ai/settings             — update DB config (sealed keys)
 *   GET  /api/v1/admin/ai/models               — known model list per provider
 *   POST /api/v1/admin/ai/test                 — fire a tiny prompt
 *
 * The DB config takes precedence over .env once any provider is
 * activated; .env stays as a fallback for fresh installs. API keys
 * are sealed via KmsClient before storage; only a 4-char prefix is
 * surfaced back to the UI.
 */

export interface AdminAiRouteDeps {
  /** Boot-time fallback provider — used when DB config is empty. */
  llmProvider?: LlmProvider | undefined;
  db?: Database;
  /** KMS for sealing API keys at rest. */
  kms?: KmsClient | undefined;
}

/**
 * Phase 23.14 — token cost ledger.
 *
 * Anthropic Claude Sonnet 4.6 published rates (as of 2026-05):
 *   input  = $3.00 / 1M tokens
 *   output = $15.00 / 1M tokens
 * The constants are env-overridable so an operator can pin to the
 * rate sheet they actually pay. The math is simple — we don't track
 * per-call price snapshots; recompute from current rates.
 */
const PRICE_PER_M_INPUT = Number(process.env.VIBE_LLM_PRICE_INPUT_PER_M ?? "3.00");
const PRICE_PER_M_OUTPUT = Number(process.env.VIBE_LLM_PRICE_OUTPUT_PER_M ?? "15.00");

function tokenCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICE_PER_M_INPUT + outputTokens * PRICE_PER_M_OUTPUT) / 1_000_000;
}

const testSchema = z.object({
  prompt: z.string().min(1).max(500).default("Reply with exactly the word: ok"),
  /** Optional model override — useful for testing a non-default model. */
  model: z.string().min(1).max(100).optional(),
});

const settingsSchema = z.object({
  activeProvider: z.enum(["anthropic", "local"]).nullable(),
  /** New API key to seal + store. Empty string means "leave existing key alone." */
  anthropicApiKey: z.string().max(500).optional(),
  /** Set to true to wipe the stored Anthropic key. */
  clearAnthropicApiKey: z.boolean().optional(),
  anthropicDefaultModel: z.string().max(100).nullable().optional(),
  localBaseUrl: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v === "" || isHttpUrl(v),
      "localBaseUrl must be http(s)://… (no cloud-metadata oracles)",
    ),
  localDefaultModel: z.string().max(100).nullable().optional(),
  localApiKey: z.string().max(500).optional(),
  clearLocalApiKey: z.boolean().optional(),
});

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const META = ["169.254.169.254", "metadata.google.internal", "metadata"];
    if (META.includes(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function readEnv(): ResolverEnv {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    VIBE_LLM_DEFAULT_MODEL: process.env.VIBE_LLM_DEFAULT_MODEL,
    VIBE_LLM_PROVIDER: process.env.VIBE_LLM_PROVIDER,
    VIBE_LLM_LOCAL_URL: process.env.VIBE_LLM_LOCAL_URL,
    VIBE_LLM_LOCAL_MODEL: process.env.VIBE_LLM_LOCAL_MODEL,
    VIBE_LLM_LOCAL_API_KEY: process.env.VIBE_LLM_LOCAL_API_KEY,
    VIBE_OFFLINE: process.env.VIBE_OFFLINE === "true",
    VIBE_DEPLOY_MODE: process.env.VIBE_DEPLOY_MODE,
  };
}

export function buildAdminAiRouter(deps: AdminAiRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("ai:configure"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const env = readEnv();
    let resolved: Awaited<ReturnType<typeof resolveLlmProvider>> = null;
    if (deps.db && deps.kms) {
      resolved = await resolveLlmProvider(deps.db, deps.kms, env);
    }
    res.json({
      configured: Boolean(resolved ?? deps.llmProvider),
      provider: resolved?.providerName ?? deps.llmProvider?.name ?? null,
      defaultModel: resolved?.defaultModel ?? null,
      source: resolved?.source ?? (deps.llmProvider ? "env" : null),
      // Surface a 4-char prefix only — admin can confirm "right key is
      // loaded" without a full secret leak. Anthropic keys begin
      // with `sk-ant-`, so longer prefixes used to leak the org family.
      apiKeyHint: process.env.ANTHROPIC_API_KEY
        ? `${process.env.ANTHROPIC_API_KEY.slice(0, 4)}…`
        : null,
      localUrl:
        resolved?.providerName === "local" ? (process.env.VIBE_LLM_LOCAL_URL ?? null) : null,
      offline: env.VIBE_OFFLINE === true,
    });
  });

  /** Phase 23.4 — DB-backed config GET. Returns masked key prefixes only. */
  router.get(
    "/settings",
    requirePermission("ai:configure"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      if (!deps.db || !deps.kms) {
        return problem(res, 503, "Service unavailable", "DB or KMS not configured");
      }
      const settings = await getAiProviderSettings(deps.db);
      const env = readEnv();
      res.json({
        settings: {
          activeProvider: settings.activeProvider,
          anthropicApiKeyPrefix: settings.anthropicApiKeySealed
            ? maskedPrefix(deps.kms, settings.anthropicApiKeySealed)
            : null,
          anthropicDefaultModel: settings.anthropicDefaultModel,
          localBaseUrl: settings.localBaseUrl,
          localDefaultModel: settings.localDefaultModel,
          localApiKeyConfigured: Boolean(settings.localApiKeySealed),
          updatedAt: settings.updatedAt.toISOString(),
        },
        envFallback: {
          anthropicApiKeySet: Boolean(env.ANTHROPIC_API_KEY),
          anthropicDefaultModel: env.VIBE_LLM_DEFAULT_MODEL ?? null,
          localBaseUrl: env.VIBE_LLM_LOCAL_URL ?? null,
          localDefaultModel: env.VIBE_LLM_LOCAL_MODEL ?? null,
          offline: env.VIBE_OFFLINE === true,
        },
      });
    },
  );

  /** Phase 23.4 — DB-backed config PUT. Seals new keys before storage. */
  router.put(
    "/settings",
    requirePermission("ai:configure"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      if (!deps.db || !deps.kms) {
        return problem(res, 503, "Service unavailable", "DB or KMS not configured");
      }
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return problem(res, 400, "Bad request", "Invalid body", {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      const body = parsed.data;
      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedBy: req.user.id,
      };
      if (body.activeProvider !== undefined) patch.activeProvider = body.activeProvider;
      if (body.anthropicDefaultModel !== undefined)
        patch.anthropicDefaultModel = body.anthropicDefaultModel || null;
      if (body.localBaseUrl !== undefined) patch.localBaseUrl = body.localBaseUrl || null;
      if (body.localDefaultModel !== undefined)
        patch.localDefaultModel = body.localDefaultModel || null;
      if (body.clearAnthropicApiKey === true) {
        patch.anthropicApiKeySealed = null;
      } else if (body.anthropicApiKey && body.anthropicApiKey.length > 0) {
        patch.anthropicApiKeySealed = deps.kms.encrypt(body.anthropicApiKey);
      }
      if (body.clearLocalApiKey === true) {
        patch.localApiKeySealed = null;
      } else if (body.localApiKey && body.localApiKey.length > 0) {
        patch.localApiKeySealed = deps.kms.encrypt(body.localApiKey);
      }

      await deps.db
        .update(aiProviderSettings)
        .set(patch)
        .where(eq(aiProviderSettings.id, AI_PROVIDER_SETTINGS_ID));

      // Audit row tracks WHICH fields changed, not the values.
      await recordAuditEvent(deps.db, {
        action: "client.update",
        entityKind: "client",
        entityId: AI_PROVIDER_SETTINGS_ID,
        actorUserId: req.user.id,
        payload: {
          fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
          target: "ai_provider_settings",
        },
      });

      res.status(204).end();
    },
  );

  /** Phase 23.4 — known model lists. */
  router.get("/models", requirePermission("ai:configure"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const provider = (req.query.provider as string) || "";
    // Try to live-fetch local provider's /models endpoint when
    // requested — vibe-llm-server / Ollama / many gateways expose
    // OpenAI-compatible /v1/models. Falls back to the curated list
    // when the gateway doesn't or the request fails.
    if (provider === "local" && deps.db) {
      const settings = await getAiProviderSettings(deps.db);
      const baseUrl = settings.localBaseUrl ?? process.env.VIBE_LLM_LOCAL_URL;
      if (baseUrl) {
        const live = await fetchLocalModels(baseUrl).catch(() => null);
        if (live && live.length > 0) {
          res.json({ models: live, source: "live" });
          return;
        }
      }
    }
    const list = provider === "local" ? KNOWN_MODELS.local : KNOWN_MODELS.anthropic;
    res.json({ models: list, source: "curated" });
  });

  // Phase 23.14 — usage ledger. Returns rolling 30-day stats:
  // totals, per-user, and per-day. Anchored to extraction_jobs.input_tokens
  // / output_tokens, costs computed at current rate-sheet.
  router.get("/usage", requirePermission("user:list"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    if (!deps.db) {
      return problem(res, 503, "Service unavailable", "Database not configured");
    }
    const sinceDays = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const rows = await deps.db
      .select()
      .from(extractionJobs)
      .where(gte(extractionJobs.createdAt, since))
      .orderBy(desc(extractionJobs.createdAt));
    const userRows = await deps.db.select({ id: users.id, name: users.name }).from(users);
    const userById = new Map(userRows.map((u) => [u.id, u.name]));

    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let totalCalls = 0;
    let totalSucceeded = 0;
    const perUser = new Map<
      string,
      { name: string; calls: number; input: number; output: number; cost: number }
    >();
    const perDay = new Map<
      string,
      { calls: number; input: number; output: number; cost: number }
    >();

    for (const r of rows) {
      const inputT = r.inputTokens ?? 0;
      const outputT = r.outputTokens ?? 0;
      const cost = tokenCostUsd(inputT, outputT);
      const day = r.createdAt.toISOString().slice(0, 10);
      const userId = r.createdBy ?? "system";
      const userName = userById.get(userId) ?? "(unknown)";

      totalCalls++;
      totalInput += inputT;
      totalOutput += outputT;
      totalCost += cost;
      if (r.status === "approved" || r.status === "needs_review") totalSucceeded++;

      const u = perUser.get(userId) ?? { name: userName, calls: 0, input: 0, output: 0, cost: 0 };
      u.calls++;
      u.input += inputT;
      u.output += outputT;
      u.cost += cost;
      perUser.set(userId, u);

      const d = perDay.get(day) ?? { calls: 0, input: 0, output: 0, cost: 0 };
      d.calls++;
      d.input += inputT;
      d.output += outputT;
      d.cost += cost;
      perDay.set(day, d);
    }

    res.json({
      windowDays: sinceDays,
      since: since.toISOString(),
      rates: { inputPerM: PRICE_PER_M_INPUT, outputPerM: PRICE_PER_M_OUTPUT },
      totals: {
        calls: totalCalls,
        succeeded: totalSucceeded,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        costUsd: Number(totalCost.toFixed(4)),
      },
      perUser: [...perUser.entries()]
        .map(([id, v]) => ({
          userId: id,
          name: v.name,
          calls: v.calls,
          inputTokens: v.input,
          outputTokens: v.output,
          costUsd: Number(v.cost.toFixed(4)),
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
      perDay: [...perDay.entries()]
        .map(([day, v]) => ({
          day,
          calls: v.calls,
          inputTokens: v.input,
          outputTokens: v.output,
          costUsd: Number(v.cost.toFixed(4)),
        }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    });
  });

  router.post("/test", requirePermission("ai:configure"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    // Resolve the *current* provider — DB > env. This means a user
    // who saves a key + clicks Test gets the freshly-saved key, no
    // restart needed.
    let provider: LlmProvider | undefined;
    if (deps.db && deps.kms) {
      const resolved = await resolveLlmProvider(deps.db, deps.kms, readEnv());
      if (resolved) provider = resolved.provider;
    }
    if (!provider) provider = deps.llmProvider;
    if (!provider) {
      return problem(
        res,
        503,
        "Service unavailable",
        "No LLM provider configured. Set the API key under Admin → AI provider, or via ANTHROPIC_API_KEY in .env.",
      );
    }
    const start = Date.now();
    try {
      const out = await provider.generate({
        prompt: parsed.data.prompt,
        maxTokens: 32,
        temperature: 0,
        ...(parsed.data.model ? { model: parsed.data.model } : {}),
      });
      res.json({
        ok: true,
        provider: provider.name,
        model: out.model,
        elapsedMs: Date.now() - start,
        text: out.text,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return problem(res, 502, "LLM error", message);
    }
  });

  return router;
}

/** Decrypt a sealed key just to extract the 4-char prefix for the UI. */
function maskedPrefix(kms: KmsClient, sealed: string): string | null {
  try {
    const plain = kms.decrypt(sealed);
    return plain.length >= 4 ? `${plain.slice(0, 4)}…` : "…";
  } catch {
    return "(unsealable — KMS key may have rotated)";
  }
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

/** Best-effort live fetch of an OpenAI-compatible /v1/models endpoint. */
async function fetchLocalModels(baseUrl: string): Promise<{ id: string; label: string }[] | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as OpenAiModelsResponse;
    if (!Array.isArray(json.data)) return null;
    const out = json.data
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => ({ id, label: id }));
    return out.length > 0 ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
