import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  buildEnrollment,
  generateRecoveryCodes,
  hashRecoveryCode,
  recoveryCodeMatches,
  renderQrPngDataUrl,
  sealerFrom,
  verifyTotp,
} from "./totp.js";
import { TOTP, Secret } from "otpauth";
import { createKms, KmsKeyError } from "./kms.js";

describe("buildEnrollment", () => {
  it("emits a base32 secret of the expected length and an otpauth URL", () => {
    const e = buildEnrollment("alice@example.com");
    expect(e.secretBase32).toMatch(/^[A-Z2-7]+=*$/);
    expect(e.secretBase32.length).toBeGreaterThanOrEqual(32);
    expect(e.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(e.otpauthUrl).toMatch(/issuer=Vibe%20Calculators/);
    expect(e.otpauthUrl).toMatch(/algorithm=SHA1/);
    expect(e.otpauthUrl).toMatch(/digits=6/);
    expect(e.otpauthUrl).toMatch(/period=30/);
  });

  it("emits a unique secret each time", () => {
    expect(buildEnrollment("a").secretBase32).not.toBe(buildEnrollment("a").secretBase32);
  });
});

describe("renderQrPngDataUrl", () => {
  it("returns a data:image/png;base64 URL", async () => {
    const e = buildEnrollment("alice@example.com");
    const url = await renderQrPngDataUrl(e.otpauthUrl);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(url.length).toBeGreaterThan(200);
  });
});

describe("verifyTotp", () => {
  const e = buildEnrollment("alice@example.com");
  const now = new Date(2026, 0, 15, 12, 0, 0);

  function generateAt(d: Date): string {
    const totp = new TOTP({
      issuer: "Vibe Calculators",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(e.secretBase32),
    });
    return totp.generate({ timestamp: d.getTime() });
  }

  it("accepts the current code", () => {
    expect(verifyTotp(e.secretBase32, generateAt(now), now)).toBe(true);
  });

  it("accepts a code one step earlier (clock drift forgiveness)", () => {
    const earlier = new Date(now.getTime() - 30_000);
    expect(verifyTotp(e.secretBase32, generateAt(earlier), now)).toBe(true);
  });

  it("rejects a code two steps stale", () => {
    const tooOld = new Date(now.getTime() - 90_000);
    expect(verifyTotp(e.secretBase32, generateAt(tooOld), now)).toBe(false);
  });

  it("rejects a malformed code", () => {
    expect(verifyTotp(e.secretBase32, "abcdef", now)).toBe(false);
    expect(verifyTotp(e.secretBase32, "1234567", now)).toBe(false);
    expect(verifyTotp(e.secretBase32, "", now)).toBe(false);
  });
});

describe("recovery codes", () => {
  it("generates 10 codes formatted XXXXX-XXXXX", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
  });

  it("never produces duplicates within a batch", () => {
    const codes = generateRecoveryCodes(50);
    expect(new Set(codes).size).toBe(50);
  });

  it("hashRecoveryCode is case- and whitespace-insensitive", () => {
    const a = hashRecoveryCode("abc12-def34");
    const b = hashRecoveryCode("  ABC12-DEF34  ");
    expect(a).toBe(b);
  });

  it("recoveryCodeMatches is constant-time and rejects unequal", () => {
    const a = hashRecoveryCode("ABC12-DEF34");
    const b = hashRecoveryCode("ZZZZZ-ZZZZZ");
    expect(recoveryCodeMatches(a, a)).toBe(true);
    expect(recoveryCodeMatches(a, b)).toBe(false);
  });
});

describe("KMS-bound sealing", () => {
  function freshKey(): string {
    return randomBytes(32).toString("base64");
  }

  it("round-trips a TOTP secret through encrypt/decrypt", () => {
    const sealer = sealerFrom(createKms(freshKey()));
    const e = buildEnrollment("alice@example.com");
    const sealed = sealer.seal(e.secretBase32);
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain(e.secretBase32);
    expect(sealer.unseal(sealed)).toBe(e.secretBase32);
  });

  it("rejects an envelope encrypted with a different key", () => {
    const a = createKms(freshKey());
    const b = createKms(freshKey());
    const env = a.encrypt("hello");
    expect(() => b.decrypt(env)).toThrow();
  });

  it("rejects a missing key with a clear message", () => {
    expect(() => createKms(undefined)).toThrow(KmsKeyError);
    expect(() => createKms("")).toThrow(KmsKeyError);
  });

  it("rejects a key that doesn't decode to 32 bytes", () => {
    expect(() => createKms("dGVzdA==")).toThrow(/32 bytes/);
  });
});
