/**
 * Integration test fixture — spins up an in-memory Postgres via
 * pglite (embedded WASM build), applies every Drizzle migration in
 * packages/db/drizzle/, and yields a Drizzle client bound to it.
 *
 * Each test gets its own pglite instance so there's no cross-test
 * leakage. pglite is fast enough (~50ms boot + per-query overhead
 * comparable to a real Postgres) to make this practical for unit-
 * test-style integration coverage.
 *
 * Type aliasing note: Drizzle's pglite Database type and the
 * NodePgDatabase type from @vibe-calc/db diverge on internal
 * generics (different transitive drizzle-orm paths under pnpm). The
 * fixture exposes the test db typed as the production `Database`
 * via an unknown-cast at the boundary — this keeps every consumer
 * happy without leaking a separate test type into route code.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@vibe-calc/db";
import { schema } from "@vibe-calc/db";

export type TestDb = Database;

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "..", "..", "..", "..", "packages", "db", "drizzle");

function loadOrderedMigrations(): { name: string; sql: string }[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((name) => ({
    name,
    sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
  }));
}

/**
 * Creates a fresh in-memory Postgres + applies every committed
 * migration. The returned `close()` releases the pglite instance.
 */
export async function makeTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const pg = new PGlite();
  await pg.waitReady;

  for (const m of loadOrderedMigrations()) {
    const statements = m.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of statements) {
      await pg.exec(s);
    }
  }

  const drizzleClient = drizzle(pg, { schema });
  // Identical for query purposes; the type drift is purely in
  // generic-parameter resolution under pnpm's nested drizzle-orm
  // resolution. Tests issue ordinary Drizzle calls; nothing reaches
  // into pglite-specific APIs through this seam.
  const db = drizzleClient as unknown as TestDb;
  return {
    db,
    close: async () => {
      await pg.close();
    },
  };
}
