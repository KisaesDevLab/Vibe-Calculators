import { describe, expect, it } from "vitest";
import { MAGIC_LINK_TTL_MS, generateMagicLinkToken, hashMagicLinkToken } from "./magic-link.js";

describe("magic-link constants", () => {
  it("TTL is 15 minutes per build plan §2.6", () => {
    expect(MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe("generateMagicLinkToken", () => {
  it("returns 64 lowercase hex chars (32 random bytes)", () => {
    const t = generateMagicLinkToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits unique tokens on consecutive calls", () => {
    expect(generateMagicLinkToken()).not.toBe(generateMagicLinkToken());
  });
});

describe("hashMagicLinkToken", () => {
  it("returns 64 hex chars (SHA-256 hex)", () => {
    const t = generateMagicLinkToken();
    expect(hashMagicLinkToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const t = generateMagicLinkToken();
    expect(hashMagicLinkToken(t)).toBe(hashMagicLinkToken(t));
  });

  it("yields different hashes for different inputs", () => {
    expect(hashMagicLinkToken("a")).not.toBe(hashMagicLinkToken("b"));
  });

  it("never returns the original token (one-way)", () => {
    const t = generateMagicLinkToken();
    expect(hashMagicLinkToken(t)).not.toBe(t);
  });
});

// Integration tests for requestMagicLink / consumeMagicLink live in
// apps/api/src/test/auth-flows.integration.test.ts (added at Phase
// 2.12 alongside the test-DB fixture); they exercise the rows in
// magic_link_tokens against a real postgres via pglite/testcontainers.
