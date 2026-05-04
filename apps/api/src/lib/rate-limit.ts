import type { Redis } from "ioredis";

/**
 * Phase 2.7 — login rate limit + lockout escalation.
 *
 * Per build plan §2.7: 5 attempts / 15 minutes / IP+email pair.
 * Beyond that, the (ip, email) tuple is locked for an escalating
 * duration; each subsequent lockout within a 24h window roughly
 * doubles the wait (capped at 24h).
 *
 * Storage is keyed by SHA-256(ip|email) so the original values aren't
 * stored in Redis (some firms log Redis traffic). The helper takes
 * the raw values; hashing happens internally.
 */

import { createHash } from "node:crypto";

const ATTEMPT_WINDOW_SECONDS = 15 * 60;
const ATTEMPT_LIMIT = 5;
const LOCKOUT_HISTORY_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_LOCKOUT_SECONDS = 24 * 60 * 60;

/**
 * Sequence of lockout durations indexed by the lockout count
 * accumulated within the LOCKOUT_HISTORY_WINDOW. Index 0 = 1st
 * lockout, index 1 = 2nd, etc. Last entry repeats for any further
 * lockouts.
 */
const LOCKOUT_LADDER_SECONDS: readonly number[] = [
  15 * 60, // 15 min  (1st)
  30 * 60, // 30 min  (2nd)
  60 * 60, // 1 hour  (3rd)
  4 * 60 * 60, // 4 hours (4th)
  MAX_LOCKOUT_SECONDS, // 24 hours (5th and beyond)
];

function lockoutDurationFor(historyCount: number): number {
  const idx = Math.min(historyCount, LOCKOUT_LADDER_SECONDS.length - 1);
  return LOCKOUT_LADDER_SECONDS[idx]!;
}

function keyFor(ip: string, email: string): string {
  return createHash("sha256").update(`${ip}|${email.toLowerCase()}`).digest("hex");
}

export interface KeyValueStore {
  /** Get the raw string value (or null). */
  get(key: string): Promise<string | null>;
  /** Set with TTL in seconds. Overwrites any existing. */
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>;
  /** Increment, returning new count. If key didn't exist, expire after ttl. */
  incrEx(key: string, ttlSeconds: number): Promise<number>;
  /** Delete the key. Idempotent. */
  del(...keys: string[]): Promise<void>;
  /** TTL in seconds; -2 if missing, -1 if no expiry. */
  pttl(key: string): Promise<number>;
}

/** Adapter binding our store interface to an ioredis client. */
export function redisStore(client: Redis): KeyValueStore {
  return {
    async get(key) {
      return client.get(key);
    },
    async setEx(key, ttl, value) {
      await client.set(key, value, "EX", ttl);
    },
    async incrEx(key, ttl) {
      const n = await client.incr(key);
      if (n === 1) await client.expire(key, ttl);
      return n;
    },
    async del(...keys) {
      if (keys.length > 0) await client.del(...keys);
    },
    async pttl(key) {
      return client.pttl(key);
    },
  };
}

/** In-memory store for tests. Honors TTL via setTimeout-free expiry checks. */
export function memoryStore(now: () => number = () => Date.now()): KeyValueStore {
  const store = new Map<string, { value: string; expiresAt: number }>();
  function purge(): void {
    const t = now();
    for (const [k, v] of store) {
      if (v.expiresAt <= t) store.delete(k);
    }
  }
  return {
    async get(key) {
      purge();
      return store.get(key)?.value ?? null;
    },
    async setEx(key, ttl, value) {
      store.set(key, { value, expiresAt: now() + ttl * 1000 });
    },
    async incrEx(key, ttl) {
      purge();
      const existing = store.get(key);
      if (!existing) {
        store.set(key, { value: "1", expiresAt: now() + ttl * 1000 });
        return 1;
      }
      const next = Number(existing.value) + 1;
      store.set(key, { value: String(next), expiresAt: existing.expiresAt });
      return next;
    },
    async del(...keys) {
      for (const k of keys) store.delete(k);
    },
    async pttl(key) {
      purge();
      const v = store.get(key);
      if (!v) return -2;
      return Math.max(0, v.expiresAt - now());
    },
  };
}

export interface LockoutStatus {
  locked: true;
  /** Wall-clock ms remaining on the current lockout. */
  retryAfterMs: number;
}

export interface NotLocked {
  locked: false;
}

export type LockoutResult = LockoutStatus | NotLocked;

export interface RateLimiter {
  /** Check the current lockout state without recording an attempt. */
  status(ip: string, email: string): Promise<LockoutResult>;
  /**
   * Record one failed login. Returns the resulting lockout state —
   * if `locked: true` the caller must reject the login attempt
   * immediately even if the password was correct.
   */
  recordFailure(ip: string, email: string): Promise<LockoutResult>;
  /** Clear all counters + lockouts for the (ip, email) pair. */
  clearOnSuccess(ip: string, email: string): Promise<void>;
  /** Admin override — clears lockout AND lockout history. */
  adminClear(ip: string, email: string): Promise<void>;
}

export function createRateLimiter(store: KeyValueStore): RateLimiter {
  function lockedKey(k: string): string {
    return `rl:login:locked:${k}`;
  }
  function attemptsKey(k: string): string {
    return `rl:login:attempts:${k}`;
  }
  function historyKey(k: string): string {
    return `rl:login:history:${k}`;
  }

  return {
    async status(ip, email) {
      const k = keyFor(ip, email);
      const ttl = await store.pttl(lockedKey(k));
      if (ttl > 0) return { locked: true, retryAfterMs: ttl };
      return { locked: false };
    },

    async recordFailure(ip, email) {
      const k = keyFor(ip, email);
      const lockTtl = await store.pttl(lockedKey(k));
      if (lockTtl > 0) return { locked: true, retryAfterMs: lockTtl };

      const attempts = await store.incrEx(attemptsKey(k), ATTEMPT_WINDOW_SECONDS);
      if (attempts < ATTEMPT_LIMIT) return { locked: false };

      const history = await store.incrEx(historyKey(k), LOCKOUT_HISTORY_WINDOW_SECONDS);
      const duration = lockoutDurationFor(history - 1);
      await store.setEx(lockedKey(k), duration, "1");
      await store.del(attemptsKey(k));
      return { locked: true, retryAfterMs: duration * 1000 };
    },

    async clearOnSuccess(ip, email) {
      const k = keyFor(ip, email);
      await store.del(attemptsKey(k), lockedKey(k));
      // history is intentionally preserved within its 24h window so
      // a single lucky login between two attack bursts can't reset
      // the escalation ladder.
    },

    async adminClear(ip, email) {
      const k = keyFor(ip, email);
      await store.del(attemptsKey(k), lockedKey(k), historyKey(k));
    },
  };
}

export const RATE_LIMIT_CONSTANTS = {
  ATTEMPT_WINDOW_SECONDS,
  ATTEMPT_LIMIT,
  LOCKOUT_HISTORY_WINDOW_SECONDS,
  MAX_LOCKOUT_SECONDS,
  LOCKOUT_LADDER_SECONDS,
} as const;
