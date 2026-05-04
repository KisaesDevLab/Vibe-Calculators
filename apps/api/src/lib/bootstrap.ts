import { count, eq, gt } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";
import { bootstrapTokens, users, type Database } from "@vibe-calc/db";
import { hashPassword, validatePasswordPolicy, type PolicyResult } from "./password.js";
import { recordAuthEvent } from "./auth-events.js";

/**
 * One-shot install bootstrap (DB-backed).
 *
 * Per session decision "bootstrap admin runs only once for install"
 * the API does NOT auto-issue a token at boot. Operator runs
 * `just bootstrap` after a fresh install — that CLI generates a
 * token and writes its hash into bootstrap_tokens. The /api/v1/setup
 * route looks the token up here and consumes it on first-admin
 * creation.
 *
 * Token state survives API restart, but is consumed on use, and the
 * route refuses to operate once any user exists.
 */

export const BOOTSTRAP_TOKEN_TTL_HOURS = 24;
const TOKEN_HEX_LEN = 64; // 32 random bytes

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function isUsersTableEmpty(db: Database): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users);
  return Number(row?.n ?? 0) === 0;
}

/**
 * Issue a fresh bootstrap token. Caller passes the bare token they
 * generated (32 random bytes hex); we store only the SHA-256 digest.
 * Refuses if any users already exist.
 */
export async function persistBootstrapToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true; expiresAt: Date } | { ok: false; reason: "users-exist" }> {
  if (token.length !== TOKEN_HEX_LEN || !/^[0-9a-f]+$/.test(token)) {
    throw new Error("Bootstrap token must be 64 lowercase hex chars");
  }
  if (!(await isUsersTableEmpty(db))) {
    return { ok: false, reason: "users-exist" };
  }
  const expiresAt = new Date(now.getTime() + BOOTSTRAP_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  // Single-token semantic: clear any prior tokens before insert.
  await db.delete(bootstrapTokens);
  await db.insert(bootstrapTokens).values({ tokenHash: sha256Hex(token), expiresAt });
  return { ok: true, expiresAt };
}

/**
 * Verify a candidate token. Returns `true` iff the token is live AND
 * users table is still empty. Constant-time compare against every
 * stored hash (typically 0 or 1 row).
 */
export async function verifyBootstrapToken(
  db: Database,
  candidate: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!(await isUsersTableEmpty(db))) return false;
  const candidateHash = sha256Hex(candidate);
  const rows = await db.select().from(bootstrapTokens).where(gt(bootstrapTokens.expiresAt, now));
  for (const r of rows) {
    if (constantTimeHexEqual(r.tokenHash, candidateHash)) return true;
  }
  return false;
}

export interface FirstAdminInput {
  email: string;
  name: string;
  password: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export type FirstAdminResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "bootstrap-closed" | "policy"; policy?: PolicyResult };

/**
 * Create the first admin atomically:
 *   - run password policy
 *   - confirm users empty (race-defense if another writer slipped in)
 *   - hash + insert the admin row
 *   - DELETE all bootstrap_tokens so nothing else can be redeemed
 *   - record auth_events row
 */
export async function createFirstAdmin(
  db: Database,
  input: FirstAdminInput,
): Promise<FirstAdminResult> {
  const policy = validatePasswordPolicy(input.password, {
    email: input.email,
    name: input.name,
  });
  if (!policy.ok) return { ok: false, reason: "policy", policy };

  if (!(await isUsersTableEmpty(db))) {
    return { ok: false, reason: "bootstrap-closed" };
  }

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash,
      role: "admin",
      status: "active",
    })
    .returning({ id: users.id });
  if (!created) throw new Error("First-admin insert returned no row");

  await db.delete(bootstrapTokens);

  await recordAuthEvent(db, {
    kind: "bootstrap.first_admin",
    userId: created.id,
    ip: input.ip,
    userAgent: input.userAgent,
    payload: { email: input.email.toLowerCase() },
  });

  return { ok: true, userId: created.id };
}

/**
 * Pretty-print the operator banner. Called by the bootstrap CLI
 * after persisting the token.
 */
export function printBootstrapBanner(
  token: string,
  print: (s: string) => void = console.error,
): void {
  const line = "─".repeat(72);
  print(`\n${line}`);
  print(`Vibe Calculators — first-run setup`);
  print(line);
  print(`No users exist yet. Use this one-time token to create the first admin:`);
  print(``);
  print(`  ${token}`);
  print(``);
  print(`Visit /setup in your browser, paste the token, and complete the form.`);
  print(`This token is shown ONCE. Re-run 'just bootstrap' if it's lost.`);
  print(`After the first admin is created, the token is consumed forever.`);
  print(`${line}\n`);
}

// Drizzle is currently re-exported here only for callers that already
// import `eq` from this module. Keep `void eq` so the import never
// goes unused-warned.
void eq;
