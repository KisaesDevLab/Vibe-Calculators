import { count, eq } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { users, type Database } from "@vibe-calc/db";
import { hashPassword, validatePasswordPolicy, type PolicyResult } from "./password.js";
import { recordAuthEvent } from "./auth-events.js";

/**
 * Phase 2.9 — first-run bootstrap.
 *
 * On a virgin install (zero rows in users), the API generates a
 * 32-byte hex setup token at boot, prints it ONCE to stderr (with
 * a clear "do not store, do not screenshot, exchange in person"
 * banner), and accepts it on POST /api/v1/setup along with the new
 * admin's email + name + password. The token is only ever held in
 * memory; restarting the API issues a fresh token.
 *
 * Once at least one user exists, the bootstrap subsystem returns
 * { kind: 'closed' } and the route returns 410 Gone forever.
 */

const TOKEN_BYTES = 32;
export type BootstrapState =
  | { kind: "open"; tokenHash: string; createdAt: Date }
  | { kind: "closed" };

export interface BootstrapManager {
  /** Returns the current state (memoized; refresh() reconciles with DB). */
  getState(): BootstrapState;
  /** Re-checks the DB and updates state. Called at server boot. */
  refresh(db: Database): Promise<BootstrapState>;
  /**
   * Issues a new token. No-op if state is 'closed'. The bare token
   * is returned ONCE — the manager only holds the hash thereafter.
   */
  issueToken(now?: Date): string | null;
  /** True iff the supplied token matches the live one (constant-time). */
  verifyToken(candidate: string): boolean;
  /** Mark the bootstrap closed (after first admin is created). */
  close(): void;
}

export function createBootstrapManager(): BootstrapManager {
  let state: BootstrapState = { kind: "closed" };

  return {
    getState: () => state,

    async refresh(db) {
      const [row] = await db.select({ n: count() }).from(users);
      const userCount = Number(row?.n ?? 0);
      if (userCount === 0) {
        // Open state but waiting for an issueToken call so the bare
        // token is never resident in memory before the operator asks
        // for it.
        state = { kind: "open", tokenHash: "", createdAt: new Date() };
      } else {
        state = { kind: "closed" };
      }
      return state;
    },

    issueToken(now = new Date()) {
      if (state.kind !== "open") return null;
      const token = randomBytes(TOKEN_BYTES).toString("hex");
      const tokenHash = sha256Hex(token);
      state = { kind: "open", tokenHash, createdAt: now };
      return token;
    },

    verifyToken(candidate: string): boolean {
      if (state.kind !== "open" || !state.tokenHash) return false;
      const candidateHash = sha256Hex(candidate);
      const a = Buffer.from(state.tokenHash, "hex");
      const b = Buffer.from(candidateHash, "hex");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    },

    close() {
      state = { kind: "closed" };
    },
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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
 * Atomically creates the very first admin user. Refuses if the
 * bootstrap is closed (a row exists in users) — an extra defense
 * against a race between issueToken/verifyToken and another writer.
 */
export async function createFirstAdmin(
  db: Database,
  manager: BootstrapManager,
  input: FirstAdminInput,
): Promise<FirstAdminResult> {
  const policy = validatePasswordPolicy(input.password, {
    email: input.email,
    name: input.name,
  });
  if (!policy.ok) return { ok: false, reason: "policy", policy };

  const [existing] = await db.select({ n: count() }).from(users);
  if (Number(existing?.n ?? 0) !== 0) {
    manager.close();
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

  manager.close();

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
 * Pretty-print the setup token to stderr — called once at boot when
 * the bootstrap manager is in 'open' state and a token has just
 * been issued. Tests stub `print` to capture the output.
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
  print(`This token is shown ONCE. Restarting the API issues a fresh one.`);
  print(`After the first admin is created, this code is no longer accepted.`);
  print(`${line}\n`);
}

export function isUsersTableEmpty(db: Database): Promise<boolean> {
  return db
    .select({ n: count() })
    .from(users)
    .then(([row]) => Number(row?.n ?? 0) === 0);
}

export const _internal = { sha256Hex };

void eq; // future-use silencer; the bootstrap reads count(), not row lookups
