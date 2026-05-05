import { Secret, TOTP } from "otpauth";
import { toDataURL } from "qrcode";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import type { KmsClient } from "./kms.js";

// Argon2id parameters for recovery-code stretching. Lighter than
// password hashing (codes are higher-entropy) but still memory-hard.
const ARGON2ID = 2 as const;
const ARGON2_MEMORY_COST = 19_456; // 19 MiB
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

/**
 * Phase 2.5 — TOTP enrollment + verification (RFC 6238).
 *
 * Algorithm: SHA-1 (the universal authenticator-app baseline; SHA-256
 * is supported by some apps but breaks Google Authenticator).
 * Period: 30 seconds. Digits: 6. Window: ±1 step (the build plan
 * doesn't pin this; ±1 is the conservative default and keeps clock
 * drift forgiveness symmetrical).
 */

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALGORITHM = "SHA1" as const;
const WINDOW_STEPS = 1;
const ISSUER = "Vibe Calculators";

export interface EnrollmentRecord {
  /** Plaintext base32 secret. Caller persists the *encrypted* form. */
  secretBase32: string;
  /** otpauth://totp/... URL the client renders into a QR. */
  otpauthUrl: string;
}

/**
 * Begin enrollment: produce a fresh secret + the otpauth URL. The
 * caller is responsible for encrypting the secret before storage and
 * for verifying a first user-supplied code via verifyTotp() before
 * setting users.totp_enabled = true.
 */
export function buildEnrollment(accountLabel: string): EnrollmentRecord {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });
  return {
    secretBase32: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

/** Render an otpauth URL as a data: URL PNG for an <img src=>. */
export async function renderQrPngDataUrl(otpauthUrl: string): Promise<string> {
  return toDataURL(otpauthUrl, { errorCorrectionLevel: "M", margin: 2, scale: 6 });
}

export function verifyTotp(secretBase32: string, code: string, now: Date = new Date()): boolean {
  return verifyTotpWithCounter(secretBase32, code, now).ok;
}

/**
 * Verify a TOTP code AND return the absolute step counter the code
 * matched at. Callers persist the counter so a replayed code (within
 * its 30s window) is rejected on second use.
 *
 * `ok` is the boolean equivalent of `delta !== null`. `counter` is the
 * absolute step (`floor(unix-seconds / 30) + delta`); it's undefined
 * when verification fails.
 */
export function verifyTotpWithCounter(
  secretBase32: string,
  code: string,
  now: Date = new Date(),
): { ok: boolean; counter?: number } {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, timestamp: now.getTime(), window: WINDOW_STEPS });
  if (delta === null) return { ok: false };
  const baseStep = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
  return { ok: true, counter: baseStep + delta };
}

// ---------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------

const RECOVERY_CODE_COUNT = 10;
// Pre-Round-2 was 5 bytes (40 bits) — GPU-crackable in seconds offline.
// 16 bytes = 128 bits is uncrackable at SHA-256 speeds; combined with
// Argon2id stretching below it's safe even against a leaked DB.
const RECOVERY_CODE_BYTES = 16;

/** Strip whitespace + dashes, uppercase. Matching/storage canonical form. */
function canonicalizeRecoveryCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Generate `count` fresh codes formatted as 4 groups of 8 hex chars
 * (e.g. `A1B2C3D4-E5F60718-…`). The dashes are cosmetic; matching
 * is whitespace + dash-insensitive via canonicalizeRecoveryCode.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase();
    // Format as 4 × 8-char groups: AABBCCDD-EEFF0011-2233445566778899
    // (8 hex / 8 hex / 16 hex = 32 chars total — matches 16 bytes).
    codes.push(`${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 32)}`);
  }
  return codes;
}

/**
 * Hash a recovery code with Argon2id (memory-hard, intentionally slow).
 * The hash output embeds a random salt so the same plaintext produces
 * different hashes — verify via `verifyRecoveryCode`.
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  const canon = canonicalizeRecoveryCode(code);
  return argon2Hash(canon, {
    algorithm: ARGON2ID,
    memoryCost: ARGON2_MEMORY_COST,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

/**
 * Verify a candidate code against a stored Argon2id hash.
 * Constant-time-equivalent (Argon2's verify is built on it).
 */
export async function verifyRecoveryCode(storedHash: string, candidate: string): Promise<boolean> {
  const canon = canonicalizeRecoveryCode(candidate);
  try {
    return await argon2Verify(storedHash, canon);
  } catch {
    return false;
  }
}

/**
 * @deprecated kept for callers that compare by string equality. New
 * code should use `verifyRecoveryCode`.
 *
 * Returns false unconditionally for stored Argon2id hashes (which
 * carry randomized salts) so this wrapper can't silently let a code
 * match by accident.
 */
export function recoveryCodeMatches(stored: string, candidate: string): boolean {
  if (stored.startsWith("$argon2")) return false;
  if (stored.length !== candidate.length) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(candidate, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------
// KMS-bound helpers — what the route handlers actually call.
// ---------------------------------------------------------------------

export interface SecretSealer {
  seal(secretBase32: string): string;
  unseal(envelope: string): string;
}

/** Wrap a KMS client into the sealer shape the totp module wants. */
export function sealerFrom(kms: KmsClient): SecretSealer {
  return {
    seal: (s) => kms.encrypt(s),
    unseal: (e) => kms.decrypt(e),
  };
}
