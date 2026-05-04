/**
 * Integration test fixture — spins up a real Postgres 16 via
 * testcontainers (one container per test file in beforeAll), runs
 * the committed Drizzle migrations from packages/db/drizzle/, and
 * yields a Drizzle client bound to it.
 *
 * Why testcontainers (not pglite): the production target is
 * Postgres 16 running on the appliance host. pglite was great for
 * speed but isn't byte-identical; constraints behave subtly
 * differently and we caught real shape drift twice in Phase 3. A
 * real postgres:16-alpine eliminates that whole class of false
 * positives/negatives.
 *
 * Speed: container start ~3-6s on the host's Docker, plus the
 * migration apply ~200ms. Tests within a file share the container
 * via beforeAll/afterAll. Per-test isolation is provided by
 * `truncateAll(db)` rather than respawning the container.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import type { Database } from "@vibe-calc/db";
import { schema } from "@vibe-calc/db";

export type TestDb = Database;

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "..", "..", "..", "..", "packages", "db", "drizzle");

export interface TestHarness {
  db: TestDb;
  pool: pg.Pool;
  container: StartedPostgreSqlContainer;
  /** Empties every domain table; auth tables; tags. Keeps schema. */
  truncateAll: () => Promise<void>;
  close: () => Promise<void>;
}

function loadOrderedMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8"),
    }));
}

const TABLES_TO_TRUNCATE = [
  "audit_events",
  "auth_events",
  "calculation_comments",
  "magic_link_tokens",
  "password_reset_tokens",
  "recovery_codes",
  "sessions",
  "calculation_versions",
  "calculations",
  "engagements",
  "entity_tags",
  "tags",
  "clients",
  "users",
] as const;

export async function makeTestDb(): Promise<TestHarness> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("vibe_test")
    .withUsername("test")
    .withPassword("test")
    // Speed: limit fsync etc for ephemeral test data.
    .withCommand([
      "postgres",
      "-c",
      "fsync=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      "full_page_writes=off",
    ])
    .start();

  const pool = new pg.Pool({
    connectionString: container.getConnectionUri(),
    max: 5,
  });
  const db = drizzle(pool, { schema }) as unknown as TestDb;

  // Apply migrations in order. We don't use drizzle/migrator because
  // a couple of our migrations (0005 specifically) are hand-written
  // ALTERs that the migrator's tracking table would still mark applied
  // — but executing manually keeps semantics identical to what
  // packages/db/migrate.ts does in production (minus the _meta row,
  // which tests don't need).
  for (const m of loadOrderedMigrations()) {
    const statements = m.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of statements) {
      await pool.query(s);
    }
  }

  return {
    db,
    pool,
    container,
    async truncateAll() {
      // CASCADE handles FK ordering; identity restart resets sequences.
      const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ");
      await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
    },
    async close() {
      await pool.end();
      await container.stop();
    },
  };
}
