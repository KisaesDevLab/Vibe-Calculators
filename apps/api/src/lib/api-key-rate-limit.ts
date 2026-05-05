import type { KeyValueStore } from "./rate-limit.js";

/**
 * Phase 24.6 — per-API-key rate limit.
 *
 * Sliding-second-window approximated as a 60-second fixed window
 * per build-plan §24.6 (60 req/min default). Each API key has its
 * own bucket keyed by `apikey:rl:<keyId>:<minute-bucket>`. The
 * `rateLimitPerMin` column on the api_keys row overrides the
 * default per-key.
 *
 * Returns `{ ok, retryAfterSec, remaining }` so the caller can emit
 * the 429 + `Retry-After` headers per the build plan.
 */

export const DEFAULT_API_KEY_LIMIT_PER_MIN = 60;
const WINDOW_SECONDS = 60;

export interface ApiKeyRateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limitPerMin: number;
}

export async function checkApiKeyRateLimit(
  store: KeyValueStore,
  args: { apiKeyId: string; limitPerMin?: number | null | undefined; nowMs?: number },
): Promise<ApiKeyRateLimitResult> {
  const limit =
    typeof args.limitPerMin === "number" && args.limitPerMin > 0
      ? args.limitPerMin
      : DEFAULT_API_KEY_LIMIT_PER_MIN;
  const now = args.nowMs ?? Date.now();
  const bucketSec = Math.floor(now / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  const key = `apikey:rl:${args.apiKeyId}:${bucketSec}`;
  const count = await store.incrEx(key, WINDOW_SECONDS);
  const remaining = Math.max(0, limit - count);
  if (count > limit) {
    // Caller should respond 429. Retry-After = seconds until next bucket.
    const retryAfterSec = Math.max(1, bucketSec + WINDOW_SECONDS - Math.floor(now / 1000));
    return { ok: false, remaining: 0, retryAfterSec, limitPerMin: limit };
  }
  return { ok: true, remaining, retryAfterSec: 0, limitPerMin: limit };
}
