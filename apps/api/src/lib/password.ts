import { hash, verify } from "@node-rs/argon2";

// Argon2id discriminator. @node-rs/argon2 exports this as an ambient
// const enum which can't be referenced under isolatedModules: true,
// so we encode the numeric value directly.
//   0 = Argon2d, 1 = Argon2i, 2 = Argon2id
const ARGON2ID = 2 as const;
import { zxcvbn, type ZxcvbnResult } from "@zxcvbn-ts/core";
import { COMMON_PASSWORDS } from "./common-passwords.js";

/**
 * Phase 2.3 — password hashing + policy.
 *
 * Argon2id parameters per CLAUDE.md "Argon2id (memory=64MB,
 * iterations=3, parallelism=4)":
 *   memoryCost: 65536 KiB (= 64 MiB)
 *   timeCost:   3
 *   parallelism: 4
 *   outputLen:  32 bytes
 *
 * @node-rs/argon2 emits the standard `$argon2id$v=19$m=...$t=...$p=...$<salt>$<hash>`
 * encoded string, which carries every parameter so verification works
 * without us tracking what params were used at hash time.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
} as const;

export interface PasswordPolicyOptions {
  /** Minimum length, enforced before any other check. Default 12. */
  minLength?: number;
  /** When true (the default), reject passwords on the COMMON_PASSWORDS list. */
  blockCommon?: boolean;
  /**
   * When set, reject passwords whose zxcvbn score is below this value.
   * 0–4; null disables zxcvbn (faster path for tests). Default 3.
   */
  zxcvbnMinScore?: number | null;
}

const DEFAULT_OPTIONS: Required<PasswordPolicyOptions> = {
  minLength: 12,
  blockCommon: true,
  zxcvbnMinScore: 3,
};

// zxcvbn-ts ships English defaults; user-supplied dictionary (email,
// name) is layered in at call time as the second arg to zxcvbn().

export interface PolicyOk {
  ok: true;
}

export interface PolicyFail {
  ok: false;
  /** A short stable code other code can map to UI messages. */
  code: "too-short" | "common-password" | "weak-password" | "contains-personal-info";
  message: string;
  /** Optional detail (zxcvbn score, suggestion text). */
  detail?: string;
}

export type PolicyResult = PolicyOk | PolicyFail;

export function validatePasswordPolicy(
  password: string,
  context: { email?: string; name?: string } = {},
  options: PasswordPolicyOptions = {},
): PolicyResult {
  const opts: Required<PasswordPolicyOptions> = { ...DEFAULT_OPTIONS, ...options };

  if (password.length < opts.minLength) {
    return {
      ok: false,
      code: "too-short",
      message: `Password must be at least ${opts.minLength} characters.`,
    };
  }

  if (opts.blockCommon && COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      code: "common-password",
      message: "This password appears in a list of commonly leaked passwords.",
    };
  }

  if (opts.zxcvbnMinScore !== null) {
    const userInputs = [context.email, context.name].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    const result: ZxcvbnResult = zxcvbn(password, userInputs);
    if (result.score < opts.zxcvbnMinScore) {
      const detail = result.feedback.suggestions.join(" ") || result.feedback.warning || "";
      const fail: PolicyFail = {
        ok: false,
        code: "weak-password",
        message: "Password is too easy to guess.",
      };
      if (detail) fail.detail = detail;
      return fail;
    }
    // zxcvbn's user-input check produces a warning when the password
    // looks like the user's own email/name — surface that as its own
    // policy failure for clearer UX.
    if (result.feedback.warning?.toLowerCase().includes("name")) {
      return {
        ok: false,
        code: "contains-personal-info",
        message: "Password should not be based on your name or email.",
      };
    }
  }

  return { ok: true };
}

/** Hash a plaintext password. Returns the standard $argon2id$ encoded string. */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Constant-time verify of a plaintext against a stored hash. Returns
 * false (rather than throwing) for malformed hashes so a corrupted
 * row can't cause request crashes.
 */
export async function verifyPassword(stored: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(stored, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** Exposed for tests that want to confirm the canonical params. */
export const ARGON2_PARAMS = ARGON2_OPTIONS;
