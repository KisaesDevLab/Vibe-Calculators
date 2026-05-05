import { Router, type Request, type Response } from "express";
import { desc, gte } from "drizzle-orm";
import { z } from "zod";
import type { LlmProvider } from "@vibe-calc/llm";
import { extractionJobs, users, type Database } from "@vibe-calc/db";
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
  db?: Database;
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
});

export function buildAdminAiRouter(deps: AdminAiRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const env = process.env;
    res.json({
      configured: Boolean(deps.llmProvider),
      provider: deps.llmProvider?.name ?? null,
      defaultModel:
        deps.llmProvider?.name === "local"
          ? (env.VIBE_LLM_LOCAL_MODEL ?? env.VIBE_LLM_DEFAULT_MODEL ?? null)
          : (env.VIBE_LLM_DEFAULT_MODEL ?? null),
      // Don't echo the API key — surface the prefix only so the
      // operator can confirm "yes, the right one is loaded" without
      // a full secret leak.
      apiKeyHint: env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 8)}…` : null,
      localUrl: deps.llmProvider?.name === "local" ? (env.VIBE_LLM_LOCAL_URL ?? null) : null,
      offline: env.VIBE_OFFLINE === "true",
    });
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
