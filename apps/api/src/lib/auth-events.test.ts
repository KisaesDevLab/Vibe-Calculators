import { describe, expect, it } from "vitest";
import { AUTH_EVENTS_GENESIS_HASH, type AuthEventKind } from "@vibe-calc/db";
import { computeRowHash } from "./auth-events.js";

describe("computeRowHash", () => {
  const baseFields: {
    id: string;
    createdAt: Date;
    kind: AuthEventKind;
    userId: string | null;
    actorUserId: string | null;
    ip: string | null;
    userAgent: string | null;
    payload: Record<string, unknown>;
  } = {
    id: "00000000-0000-0000-0000-000000000001",
    createdAt: new Date("2026-05-04T15:00:00Z"),
    kind: "login.success",
    userId: "u-1",
    actorUserId: null,
    ip: "10.0.0.1",
    userAgent: "ua-test",
    payload: { foo: 1 },
  };

  it("produces a 64-hex SHA-256 digest", () => {
    const h = computeRowHash(AUTH_EVENTS_GENESIS_HASH, baseFields);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", () => {
    expect(computeRowHash(AUTH_EVENTS_GENESIS_HASH, baseFields)).toBe(
      computeRowHash(AUTH_EVENTS_GENESIS_HASH, baseFields),
    );
  });

  it("changes when prev_hash changes", () => {
    const a = computeRowHash(AUTH_EVENTS_GENESIS_HASH, baseFields);
    const b = computeRowHash("a".repeat(64), baseFields);
    expect(a).not.toBe(b);
  });

  it("changes when any logical field is mutated", () => {
    const baseline = computeRowHash(AUTH_EVENTS_GENESIS_HASH, baseFields);
    const variants: (() => typeof baseFields)[] = [
      () => ({ ...baseFields, id: "different" }),
      () => ({ ...baseFields, userId: "u-2" }),
      () => ({ ...baseFields, ip: "10.0.0.2" }),
      () => ({ ...baseFields, kind: "login.failed" }),
      () => ({ ...baseFields, payload: { foo: 2 } }),
      () => ({
        ...baseFields,
        createdAt: new Date(baseFields.createdAt.getTime() + 1000),
      }),
    ];
    for (const v of variants) {
      expect(computeRowHash(AUTH_EVENTS_GENESIS_HASH, v())).not.toBe(baseline);
    }
  });

  it("ignores key order in payload (canonicalization)", () => {
    const a = computeRowHash(AUTH_EVENTS_GENESIS_HASH, {
      ...baseFields,
      payload: { a: 1, b: 2, c: 3 },
    });
    const b = computeRowHash(AUTH_EVENTS_GENESIS_HASH, {
      ...baseFields,
      payload: { c: 3, b: 2, a: 1 },
    });
    expect(a).toBe(b);
  });

  it("ignores key order in nested payload objects", () => {
    const a = computeRowHash(AUTH_EVENTS_GENESIS_HASH, {
      ...baseFields,
      payload: { outer: { x: 1, y: 2 } },
    });
    const b = computeRowHash(AUTH_EVENTS_GENESIS_HASH, {
      ...baseFields,
      payload: { outer: { y: 2, x: 1 } },
    });
    expect(a).toBe(b);
  });
});

// Database-touching tests for recordAuthEvent + validateAuthEventChain
// live in apps/api/src/test/auth-flows.integration.test.ts (added with
// the test-DB harness in 2.12).
