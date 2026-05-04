import { Router, type Request, type Response } from "express";
import { getVersionInfo } from "../lib/version.js";
import { pingDatabase } from "../lib/db.js";
import { pingRedis } from "../lib/redis.js";

export interface HealthDependencies {
  pingDb: () => Promise<{ connected: boolean; error?: string }>;
  pingRedis: () => Promise<{ connected: boolean; error?: string }>;
  getVersion: () => { version: string; gitSha: string };
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  gitSha: string;
  dbConnected: boolean;
  redisConnected: boolean;
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

  return router;
}
