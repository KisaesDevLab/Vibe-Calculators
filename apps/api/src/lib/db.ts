import pg from "pg";

/**
 * Minimal Postgres connectivity check used by /api/health.
 *
 * Phase 1 only needs "can we reach Postgres?". Phase 1.7 wraps this
 * connection with Drizzle ORM; later phases reuse the same Pool.
 */
const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Quick-fail in health checks rather than retrying for seconds.
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
      max: 5,
    });
  }
  return pool;
}

export interface DbPingResult {
  connected: boolean;
  error?: string;
}

export async function pingDatabase(): Promise<DbPingResult> {
  if (!process.env.DATABASE_URL) {
    return { connected: false, error: "DATABASE_URL not set" };
  }
  try {
    const client = await getPool().connect();
    try {
      await client.query("SELECT 1");
      return { connected: true };
    } finally {
      client.release();
    }
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
