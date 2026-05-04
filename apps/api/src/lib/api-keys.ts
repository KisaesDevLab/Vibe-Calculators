import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys, type ApiKeyRow, type Database } from "@vibe-calc/db";

/**
 * Phase 24.2 — API key issuance + verification.
 *
 * Format: `vibe_<8-char prefix><32-char body>`
 *   - prefix is stored in the clear (`api_keys.prefix`) for UI ID
 *   - the entire token is SHA-256 hashed and stored in `token_hash`
 *
 * Verification path:
 *   1. Parse the bearer header → split prefix vs full
 *   2. Lookup row by prefix; reject if missing/expired/revoked
 *   3. Compute SHA-256 of the full token; constant-time compare
 *   4. Update last_used_at for liveness tracking
 */

const TOKEN_LENGTH = 40; // bytes; 8 prefix + 32 body, base32-flavored.

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateToken(): { plaintext: string; prefix: string; hash: string } {
  // base32-ish alphabet so the token is URL-safe and avoids
  // easily-confused chars.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(TOKEN_LENGTH);
  let body = "";
  for (let i = 0; i < buf.length; i++) {
    const idx = buf[i]! % ALPHABET.length;
    body += ALPHABET[idx];
  }
  const plaintext = `vibe_${body}`;
  const prefix = body.slice(0, 8);
  const hash = hashToken(plaintext);
  return { plaintext, prefix, hash };
}

export interface VerifiedKey {
  row: ApiKeyRow;
  expired: boolean;
  revoked: boolean;
}

export async function verifyApiKeyHeader(
  db: Database,
  header: string | undefined,
): Promise<VerifiedKey | null> {
  if (!header) return null;
  const m = /^Bearer\s+(vibe_[A-Z2-9]+)$/.exec(header);
  if (!m) return null;
  const token = m[1]!;
  const body = token.slice("vibe_".length);
  if (body.length < 8) return null;
  const prefix = body.slice(0, 8);
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.prefix, prefix)).limit(1);
  if (!row) return null;
  if (hashToken(token) !== row.tokenHash) return null;

  const expired = !!row.expiresAt && row.expiresAt.getTime() < Date.now();
  const revoked = !!row.revokedAt;
  if (expired || revoked) return { row, expired, revoked };

  // Best-effort liveness update — non-blocking.
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

  return { row, expired: false, revoked: false };
}
