import { describe, expect, it } from "vitest";
import { ARGON2_PARAMS, hashPassword, validatePasswordPolicy, verifyPassword } from "./password.js";

describe("argon2id parameters", () => {
  it("uses memory=64MiB / time=3 / parallelism=4 per CLAUDE.md", () => {
    expect(ARGON2_PARAMS.memoryCost).toBe(65_536);
    expect(ARGON2_PARAMS.timeCost).toBe(3);
    expect(ARGON2_PARAMS.parallelism).toBe(4);
  });
});

describe("hashPassword + verifyPassword", () => {
  it("emits a $argon2id$ encoded hash", async () => {
    const h = await hashPassword("Correct-horse-battery-staple-2026!");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).toMatch(/m=65536/);
    expect(h).toMatch(/t=3/);
    expect(h).toMatch(/p=4/);
  }, 30_000);

  it("verifies the same password it just hashed", async () => {
    const pw = "Correct-horse-battery-staple-2026!";
    const h = await hashPassword(pw);
    expect(await verifyPassword(h, pw)).toBe(true);
  }, 30_000);

  it("rejects a different password", async () => {
    const h = await hashPassword("Correct-horse-battery-staple-2026!");
    expect(await verifyPassword(h, "wrong-password-but-long-enough-2026!")).toBe(false);
  }, 30_000);

  it("returns false (not throw) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-real-argon2-hash", "irrelevant")).toBe(false);
  });
});

describe("validatePasswordPolicy", () => {
  it("accepts a strong password", () => {
    const r = validatePasswordPolicy("Trombone-glacier-7!quiet-river2026", {});
    expect(r.ok).toBe(true);
  });

  it("rejects too-short", () => {
    const r = validatePasswordPolicy("short!");
    expect(r).toEqual({
      ok: false,
      code: "too-short",
      message: expect.stringMatching(/12/),
    });
  });

  it("rejects passwords on the common list (case-insensitive)", () => {
    const r = validatePasswordPolicy("Welcome2024!", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("common-password");
  });

  it("rejects weak passwords by zxcvbn score", () => {
    // 12 chars, not on common list, but very low entropy
    const r = validatePasswordPolicy("aaaaaaaaaaaa", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("weak-password");
  });

  it("can disable zxcvbn for the fast path", () => {
    const r = validatePasswordPolicy(
      "aaaaaaaaaaaa",
      {},
      { zxcvbnMinScore: null, blockCommon: false },
    );
    expect(r.ok).toBe(true);
  });

  it("treats password = email as weak (contains-personal-info)", () => {
    const r = validatePasswordPolicy("alice@example.com1!", {
      email: "alice@example.com",
    });
    expect(r.ok).toBe(false);
  });
});
