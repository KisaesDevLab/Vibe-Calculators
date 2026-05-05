import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { LlmProvider } from "@vibe-calc/llm";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 23.4 — AI provider status + test endpoint.
 *
 *   GET  /api/v1/admin/ai          — provider configured? which?
 *   POST /api/v1/admin/ai/test     — fire a tiny prompt to verify
 *                                    credentials + reachability
 *
 * Configuring the API key still happens via .env (apps/api/src/index.ts
 * reads ANTHROPIC_API_KEY at boot). This page is informational +
 * smoke-test, NOT a key-management UI — sealing keys in DB and
 * hot-reloading the provider is a follow-up.
 */

export interface AdminAiRouteDeps {
  llmProvider?: LlmProvider | undefined;
}

const testSchema = z.object({
  prompt: z.string().min(1).max(500).default("Reply with exactly the word: ok"),
});

export function buildAdminAiRouter(deps: AdminAiRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const env = process.env;
    res.json({
      configured: Boolean(deps.llmProvider),
      provider: deps.llmProvider?.name ?? null,
      defaultModel: env.VIBE_LLM_DEFAULT_MODEL ?? null,
      // Don't echo the API key — surface the prefix only so the
      // operator can confirm "yes, the right one is loaded" without
      // a full secret leak.
      apiKeyHint: env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 8)}…` : null,
      offline: env.VIBE_OFFLINE === "true",
    });
  });

  router.post("/test", requirePermission("user:list"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    if (!deps.llmProvider) {
      return problem(
        res,
        503,
        "Service unavailable",
        "No LLM provider configured. Set ANTHROPIC_API_KEY in the appliance .env and restart.",
      );
    }
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const start = Date.now();
    try {
      const out = await deps.llmProvider.generate({
        prompt: parsed.data.prompt,
        maxTokens: 32,
        temperature: 0,
      });
      res.json({
        ok: true,
        provider: deps.llmProvider.name,
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
