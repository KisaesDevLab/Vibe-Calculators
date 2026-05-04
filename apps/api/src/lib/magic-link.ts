import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  magicLinkTokens,
  users,
  type Database,
  type MagicLinkTokenRow,
  type UserRow,
} from "@vibe-calc/db";

/**
 * Phase 2.6 — magic-link login.
 *
 * Lifecycle:
 *   1. requestMagicLink(): generate a random token, hash it, store
 *      (token_hash, user_id, expires_at, ip_bound) in magic_link_tokens,
 *      return the *bare* token to the caller so the email/log layer
 *      can put it in a URL. Bare token never lands in the DB.
 *
 *   2. consumeMagicLink(): given the bare token + the requesting IP,
 *      hash, look up by hash, verify (a) not consumed (b) not expired
 *      (c) ip_bound matches the current request. On success mark
 *      consumed_at and return the user.
 *
 * Per build plan §2.6 the TTL is 15 minutes, single-use, IP-bound.
 */

const TOKEN_BYTES = 32; // 256-bit; 64 hex chars
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export function generateMagicLinkToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashMagicLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface RequestMagicLinkInput {
  userId: string;
  ip: string;
  now?: Date;
}

export interface IssuedMagicLink {
  /** Bare token — surface to email/SMS, never log. */
  token: string;
  expiresAt: Date;
}

export async function requestMagicLink(
  db: Database,
  input: RequestMagicLinkInput,
): Promise<IssuedMagicLink> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);
  const token = generateMagicLinkToken();
  const tokenHash = hashMagicLinkToken(token);
  await db.insert(magicLinkTokens).values({
    tokenHash,
    userId: input.userId,
    createdAt: now,
    expiresAt,
    ipBound: input.ip,
  });
  return { token, expiresAt };
}

export type ConsumeResult =
  | { ok: true; user: UserRow; row: MagicLinkTokenRow }
  | {
      ok: false;
      reason: "not-found" | "expired" | "consumed" | "ip-mismatch" | "user-suspended";
    };

export interface ConsumeMagicLinkInput {
  token: string;
  ip: string;
  now?: Date;
}

export async function consumeMagicLink(
  db: Database,
  input: ConsumeMagicLinkInput,
): Promise<ConsumeResult> {
  const now = input.now ?? new Date();
  const tokenHash = hashMagicLinkToken(input.token);

  // Pull the row even if expired/consumed so we can return a precise
  // failure reason; PK lookup is cheap.
  const rows = await db
    .select({ token: magicLinkTokens, user: users })
    .from(magicLinkTokens)
    .innerJoin(users, eq(users.id, magicLinkTokens.userId))
    .where(eq(magicLinkTokens.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: "not-found" };
  if (row.token.consumedAt !== null) return { ok: false, reason: "consumed" };
  if (row.token.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (!constantTimeEqualHex(row.token.ipBound, input.ip) && row.token.ipBound !== input.ip) {
    return { ok: false, reason: "ip-mismatch" };
  }
  if (row.user.status === "suspended" || row.user.archivedAt !== null) {
    return { ok: false, reason: "user-suspended" };
  }

  // Single-use: mark consumed atomically. If another request already
  // consumed it (race), the affected count is zero and we surface
  // 'consumed'.
  const consumed = await db
    .update(magicLinkTokens)
    .set({ consumedAt: now })
    .where(and(eq(magicLinkTokens.tokenHash, tokenHash), isNull(magicLinkTokens.consumedAt)))
    .returning();

  if (consumed.length === 0) return { ok: false, reason: "consumed" };

  return { ok: true, user: row.user, row: consumed[0]! };
}

/**
 * Periodic cleanup; Phase 22 cron will call this. Drops every token
 * row that is either consumed or past its expires_at.
 */
export async function purgeExpiredMagicLinks(db: Database, now: Date = new Date()): Promise<void> {
  await db
    .delete(magicLinkTokens)
    .where(or(isNotNull(magicLinkTokens.consumedAt), lt(magicLinkTokens.expiresAt, now)));
}
