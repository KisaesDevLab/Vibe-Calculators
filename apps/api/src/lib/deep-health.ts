import type { Redis } from "ioredis";
import type pg from "pg";
import { getVersionInfo } from "./version.js";
import type { DeepHealth, DeepCheckEntry } from "../routes/health.js";

/**
 * Phase 25.9 — deep health probe.
 *
 * Stronger than /api/health (which only does a TCP-style ping):
 *   - dbReadWrite : opens a transaction, inserts + selects + rolls back
 *                   so we exercise both write path and read path
 *                   without polluting state.
 *   - redisPing   : SET / GET / DEL on a throwaway key
 *   - schemaVersion : reads the latest applied migration tag from the
 *                   drizzle.__drizzle_migrations table and confirms
 *                   the row count matches the count of migration
 *                   files we shipped (sanity check that nothing was
 *                   applied half-way).
 *   - queueDepth  : best-effort BullMQ queue length probe (returns
 *                   detail-only when no queue prefix is configured).
 *
 * Caller wires this into buildHealthRouter via `deepCheck`. Used by
 * Caddy active health checks and by `just doctor`.
 */

export interface DeepCheckConfig {
  /** Postgres pool used for the read+write probe. */
  pool: pg.Pool;
  /** Redis client used for the SET/GET/DEL probe. */
  redis: Redis;
  /** Number of migration .sql files that should be applied. */
  expectedMigrations: number;
  /** Optional BullMQ queue prefix for the queue-depth probe. */
  queuePrefix?: string;
}

const PROBE_KEY_PREFIX = "vibecalc:health:deep:";

export async function runDeepHealth(cfg: DeepCheckConfig): Promise<DeepHealth> {
  const { version, gitSha } = getVersionInfo();
  const [dbReadWrite, redisPing, schemaVersion, queueDepth] = await Promise.all([
    probeDbReadWrite(cfg.pool),
    probeRedis(cfg.redis),
    probeSchema(cfg.pool, cfg.expectedMigrations),
    cfg.queuePrefix ? probeQueueDepth(cfg.redis, cfg.queuePrefix) : Promise.resolve(undefined),
  ]);

  const allOk =
    dbReadWrite.ok &&
    redisPing.ok &&
    schemaVersion.ok &&
    (queueDepth === undefined || queueDepth.ok);

  return {
    status: allOk ? "ok" : "degraded",
    version,
    gitSha,
    checks: {
      dbReadWrite,
      redisPing,
      schemaVersion,
      ...(queueDepth ? { queueDepth } : {}),
    },
  };
}

async function probeDbReadWrite(pool: pg.Pool): Promise<DeepCheckEntry> {
  const start = Date.now();
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // Probe a real round-trip: write to a temp table that disappears
    // at COMMIT/ROLLBACK so we can't pollute application data even
    // if something goes wrong.
    await client.query("CREATE TEMP TABLE _vibe_health_probe (n int) ON COMMIT DROP");
    await client.query("INSERT INTO _vibe_health_probe(n) VALUES (1), (2), (3)");
    const r = await client.query<{ s: number }>("SELECT sum(n)::int AS s FROM _vibe_health_probe");
    await client.query("ROLLBACK");
    if (r.rows[0]?.s !== 6) {
      return { ok: false, detail: `unexpected sum ${r.rows[0]?.s}`, elapsedMs: Date.now() - start };
    }
    return { ok: true, elapsedMs: Date.now() - start };
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // best-effort
      }
    }
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  } finally {
    client?.release();
  }
}

async function probeRedis(redis: Redis): Promise<DeepCheckEntry> {
  const start = Date.now();
  const key = `${PROBE_KEY_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await redis.set(key, "ok", "EX", 30);
    const v = await redis.get(key);
    await redis.del(key);
    if (v !== "ok") {
      return {
        ok: false,
        detail: `unexpected value ${v ?? "null"}`,
        elapsedMs: Date.now() - start,
      };
    }
    return { ok: true, elapsedMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  }
}

async function probeSchema(pool: pg.Pool, expected: number): Promise<DeepCheckEntry> {
  const start = Date.now();
  try {
    // Drizzle's __drizzle_migrations table has columns (id, hash,
    // created_at). It doesn't store the tag string — only the file
    // hash and the apply timestamp. We count rows and report the
    // most-recent created_at as a coarse "latest applied at" stamp.
    const r = await pool.query<{ count: string; latest: string | null }>(
      `SELECT
         (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS count,
         (SELECT to_timestamp(max(created_at) / 1000)::text
            FROM drizzle.__drizzle_migrations) AS latest`,
    );
    const row = r.rows[0];
    const applied = Number(row?.count ?? "0");
    if (applied !== expected) {
      return {
        ok: false,
        detail: `applied=${applied} expected=${expected} latest=${row?.latest ?? "none"}`,
        elapsedMs: Date.now() - start,
      };
    }
    return {
      ok: true,
      detail: `applied=${applied} latest=${row?.latest ?? ""}`,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  }
}

async function probeQueueDepth(redis: Redis, prefix: string): Promise<DeepCheckEntry> {
  const start = Date.now();
  try {
    // BullMQ stores waiting jobs in `${prefix}:waiting` (a Redis list).
    // We sum waiting + delayed for the headline depth.
    const [waiting, delayed] = await Promise.all([
      redis.llen(`${prefix}:waiting`).catch(() => 0),
      redis.zcard(`${prefix}:delayed`).catch(() => 0),
    ]);
    const total = (waiting ?? 0) + (delayed ?? 0);
    return {
      ok: total < 1000, // soft threshold; > 1k waiting is a yellow flag
      detail: `waiting=${waiting ?? 0} delayed=${delayed ?? 0}`,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  }
}
