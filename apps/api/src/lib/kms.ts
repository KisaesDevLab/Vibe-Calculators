import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Phase 2.5 / 23 — at-rest encryption for high-sensitivity secrets
 * (TOTP shared secrets, per-firm Anthropic API key).
 *
 * AES-256-GCM with a 12-byte random IV per encryption. The output
 * format is `v1:<base64-iv><base64-tag><base64-ciphertext>` so the
 * version prefix lets us rotate the algorithm without inferring the
 * shape from byte counts.
 *
 * The key is supplied via VIBE_KMS_KEY env: 32 raw bytes, base64.
 * Generate with: openssl rand -base64 32
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export class KmsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsKeyError";
  }
}

function decodeKey(b64: string | undefined): Buffer {
  if (!b64) {
    throw new KmsKeyError("VIBE_KMS_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) {
    throw new KmsKeyError(
      `VIBE_KMS_KEY must decode to 32 bytes (got ${raw.length}). Regenerate with openssl rand -base64 32.`,
    );
  }
  return raw;
}

export interface KmsClient {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

/**
 * Builds a KMS client bound to a specific key. Tests pass a fixed
 * key; in production loadEnv() supplies the env-driven value.
 */
export function createKms(keyB64: string | undefined): KmsClient {
  const key = decodeKey(keyB64);
  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv(ALGO, key, iv);
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
    },
    decrypt(envelope: string): string {
      const parts = envelope.split(":");
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new KmsKeyError(`Unexpected envelope format`);
      }
      const iv = Buffer.from(parts[1] ?? "", "base64");
      const tag = Buffer.from(parts[2] ?? "", "base64");
      const ct = Buffer.from(parts[3] ?? "", "base64");
      if (iv.length !== IV_LEN) throw new KmsKeyError("IV length mismatch");
      if (tag.length !== TAG_LEN) throw new KmsKeyError("Tag length mismatch");
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString("utf8");
    },
  };
}
