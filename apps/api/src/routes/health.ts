import { Router, type Request, type Response } from "express";
import { getVersionInfo } from "../lib/version.js";
import { pingDatabase } from "../lib/db.js";
import { pingRedis } from "../lib/redis.js";

export interface HealthDependencies {
  pingDb: () => Promise<{ connected: boolean; error?: string }>;
  pingRedis: () => Promise<{ connected: boolean; error?: string }>;
  getVersion: () => { version: string; gitSha: string };
  /** Phase 25.9 — deep checks. Optional so the basic /api/health
   *  works in tests that don't supply a real DB / Redis client. */
  deepCheck?: () => Promise<DeepHealth>;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  gitSha: string;
  dbConnected: boolean;
  redisConnected: boolean;
}

export interface DeepCheckEntry {
  ok: boolean;
  detail?: string;
  elapsedMs?: number;
}

export interface DeepHealth {
  status: "ok" | "degraded";
  version: string;
  gitSha: string;
  checks: {
    dbReadWrite: DeepCheckEntry;
    redisPing: DeepCheckEntry;
    schemaVersion: DeepCheckEntry;
    queueDepth?: DeepCheckEntry;
  };
}

/**
 * Builds the /api/health route. Dependencies are injected so tests
 * can stub DB/Redis without a real stack running.
 */
export function buildHealthRouter(
  deps: HealthDependencies = {
    pingDb: pingDatabase,
    pingRedis,
    getVersion: getVersionInfo,
  },
): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response<HealthResponse>) => {
    const [dbResult, redisResult] = await Promise.all([deps.pingDb(), deps.pingRedis()]);
    const { version, gitSha } = deps.getVersion();
    const allOk = dbResult.connected && redisResult.connected;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      version,
      gitSha,
      dbConnected: dbResult.connected,
      redisConnected: redisResult.connected,
    });
  });

  // Phase 25.9 — deep health check. Used by Caddy active health
  // checks and by `just doctor`. Returns 200 only when every probe
  // is green; degraded probes return 503 with per-check detail.
  router.get("/deep", async (_req: Request, res: Response) => {
    if (!deps.deepCheck) {
      res.status(503).json({
        status: "degraded",
        error: "deep checks not configured",
      });
      return;
    }
    const result = await deps.deepCheck();
    res.status(result.status === "ok" ? 200 : 503).json(result);
  });

  return router;
}
