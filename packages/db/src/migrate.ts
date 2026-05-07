/**
 * Migration runner. Used in two places:
 *
 *   1. The CLI entry (`pnpm --filter @vibe-calc/db drizzle:migrate`,
 *      `just migrate`, `vibecalc-installer migrate`). Boots its own
 *      pg.Pool from DATABASE_URL.
 *
 *   2. The API server boots — `apps/api/src/index.ts` calls
 *      `applyMigrations(db)` before any other DB work so the appliance
 *      bootstrap (which creates the database but does not run
 *      migrations) ends up with a fully migrated schema by the time
 *      the seeder reads `users`.
 *
 * Drizzle's `migrate()` is idempotent — already-applied migrations are
 * no-ops, so calling this on every API boot is safe and adds only a
 * single SELECT to `drizzle.__drizzle_migrations`.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "..", "drizzle");

const SCHEMA_VERSION_AT_BOOTSTRAP = "0000_initial";

// Loosely typed so callers can pass either the plain NodePgDatabase
// or our schema-typed `Database`. The migrator only reads metadata
// from the connection, never the schema generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyMigrations(db: NodePgDatabase<any>): Promise<void> {
  console.info("[migrate] applying migrations from", migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.info("[migrate] writing _meta bootstrap row");
  await db.execute(sql`
    INSERT INTO "_meta" ("schema_version", "notes")
    VALUES (${SCHEMA_VERSION_AT_BOOTSTRAP}, 'Bootstrap: Phase 01 schema baseline')
    ON CONFLICT ("schema_version") DO NOTHING
  `);
  console.info("[migrate] done");
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required to run migrations.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    await applyMigrations(drizzle(pool));
  } finally {
    await pool.end();
  }
}

// Run as CLI when invoked directly (`node migrate.js`). Skipped when
// imported as a library (the API path).
const invokedAsCli =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedAsCli) {
  main().catch((err: unknown) => {
    console.error("[migrate] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
