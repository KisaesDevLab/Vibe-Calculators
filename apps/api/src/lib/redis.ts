import { Redis } from "ioredis";

/**
 * Minimal Redis connectivity check used by /api/health.
 *
 * Phase 22 expands this into the BullMQ queue infrastructure;
 * until then the only consumer is the health endpoint.
 */
let client: Redis | undefined;

function getClient(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      // Fail fast in health checks rather than retrying.
      connectTimeout: 2_000,
    });
    // Suppress noisy ECONNREFUSED stack traces; pingRedis surfaces them.
    client.on("error", () => undefined);
  }
  return client;
}

export interface RedisPingResult {
  connected: boolean;
  error?: string;
}

export async function pingRedis(): Promise<RedisPingResult> {
  try {
    const c = getClient();
    if (c.status === "end") {
      // Reset closed client.
      client = undefined;
    }
    const reply = await getClient().ping();
    return { connected: reply === "PONG" };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    client.disconnect();
    client = undefined;
  }
}
