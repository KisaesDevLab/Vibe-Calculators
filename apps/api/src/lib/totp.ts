import { Secret, TOTP } from "otpauth";
import { toDataURL } from "qrcode";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { KmsClient } from "./kms.js";

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
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, timestamp: now.getTime(), window: WINDOW_STEPS });
  return delta !== null;
}

// ---------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5; // 10 hex chars per code

/** Generates 10 fresh codes formatted as `XXXXX-XXXXX` (10 hex chars + dash). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(RECOVERY_CODE_BYTES).toString("hex");
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5, 10)}`.toUpperCase());
  }
  return codes;
}

/** SHA-256 hex digest of a recovery code. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/** Compare two SHA-256 hex digests in constant time. */
export function recoveryCodeMatches(stored: string, candidate: string): boolean {
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
