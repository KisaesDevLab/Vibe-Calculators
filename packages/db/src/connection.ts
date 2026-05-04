import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  connectionString: string;
  poolMax?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}

/**
 * Creates a Drizzle-wrapped Postgres pool.
 *
 * Returns the pool alongside the database so the caller can close it
 * during graceful shutdown. Schema is the typed shape of every table
 * exported by ./schema, which gives Drizzle's relational query API
 * end-to-end type safety.
 */
export function createDatabase(opts: CreateDatabaseOptions): {
  db: Database;
  pool: pg.Pool;
} {
  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.poolMax ?? 10,
    connectionTimeoutMillis: opts.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: opts.idleTimeoutMs ?? 30_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
