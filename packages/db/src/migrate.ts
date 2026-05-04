/**
 * Migration runner. Invoked via `pnpm --filter @vibe-calc/db drizzle:migrate`
 * or by the `just migrate` task. Reads DATABASE_URL from the environment
 * and applies any pending Drizzle migrations from packages/db/drizzle/.
 *
 * After migrations run successfully, inserts (or refreshes) a row in the
 * _meta table recording the schema version and bootstrap timestamp so
 * /api/health/deep can verify schema parity.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "..", "drizzle");

const SCHEMA_VERSION_AT_BOOTSTRAP = "0000_initial";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required to run migrations.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString, max: 2 });
  const db = drizzle(pool);

  console.info("[migrate] applying migrations from", migrationsFolder);
  await migrate(db, { migrationsFolder });

  console.info("[migrate] writing _meta bootstrap row");
  await db.execute(sql`
    INSERT INTO "_meta" ("schema_version", "notes")
    VALUES (${SCHEMA_VERSION_AT_BOOTSTRAP}, 'Bootstrap: Phase 01 schema baseline')
    ON CONFLICT ("schema_version") DO NOTHING
  `);

  await pool.end();
  console.info("[migrate] done");
}

main().catch((err: unknown) => {
  console.error("[migrate] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
