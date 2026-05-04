/**
 * One-shot install bootstrap CLI.
 *
 * Run by the operator after a fresh install (typically via
 * `just bootstrap`). Generates a 32-byte random token, stores its
 * SHA-256 hash in `bootstrap_tokens`, and prints the bare token to
 * stderr.
 *
 * Refuses if the users table is non-empty so re-running on an
 * already-installed appliance is a no-op.
 */

import { count } from "drizzle-orm";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { users, bootstrapTokens } from "./schema/index";

const TOKEN_BYTES = 32;
const TOKEN_TTL_HOURS = 24;
const BANNER_LINE = "─".repeat(72);

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString, max: 2 });
  const db = drizzle(pool);

  const [row] = await db.select({ n: count() }).from(users);
  const userCount = Number(row?.n ?? 0);
  if (userCount > 0) {
    console.error(
      `[bootstrap] refusing — users table already has ${userCount} row(s). The bootstrap is single-use.`,
    );
    await pool.end();
    process.exit(2);
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await db.execute(sql`DELETE FROM "bootstrap_tokens"`);
  await db.insert(bootstrapTokens).values({ tokenHash, expiresAt });

  process.stderr.write(`\n${BANNER_LINE}\n`);
  process.stderr.write(`Vibe Calculators — first-run setup\n`);
  process.stderr.write(`${BANNER_LINE}\n`);
  process.stderr.write(
    `No users exist yet. Use this one-time token to create the first admin:\n\n`,
  );
  process.stderr.write(`  ${token}\n\n`);
  process.stderr.write(`Visit /setup in your browser, paste the token, and complete the form.\n`);
  process.stderr.write(
    `This token expires in ${TOKEN_TTL_HOURS}h. Re-run 'just bootstrap' if it's lost.\n`,
  );
  process.stderr.write(`${BANNER_LINE}\n\n`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("[bootstrap] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
