import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env.js";

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PORT: "3000",
  DATABASE_URL: "postgres://vibe:vibe@localhost:5432/vibecalc",
  REDIS_URL: "redis://localhost:6379",
  LOG_LEVEL: "info",
  VIBE_DEPLOY_MODE: "lan",
  VIBE_OFFLINE: "false",
  // 32-byte base64 key — production NODE_ENV requires it.
  VIBE_KMS_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd==",
};

describe("parseEnv", () => {
  it("returns parsed env when every required value is present", () => {
    const env = parseEnv(baseEnv);
    expect(env.PORT).toBe(3000);
    expect(env.VIBE_DEPLOY_MODE).toBe("lan");
    expect(env.VIBE_OFFLINE).toBe(false);
  });

  it("throws with a clear message when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _drop, ...rest } = baseEnv;
    expect(() => parseEnv(rest)).toThrow(EnvValidationError);
    try {
      parseEnv(rest);
    } catch (err) {
      const e = err as EnvValidationError;
      expect(e.issues.some((i: { path: string }) => i.path === "DATABASE_URL")).toBe(true);
    }
  });

  it("rejects a DATABASE_URL with the wrong scheme", () => {
    expect(() => parseEnv({ ...baseEnv, DATABASE_URL: "mysql://x/y" })).toThrow(EnvValidationError);
  });

  it("rejects a REDIS_URL with the wrong scheme", () => {
    expect(() => parseEnv({ ...baseEnv, REDIS_URL: "memcached://x" })).toThrow(EnvValidationError);
  });

  it("requires VIBE_DOMAIN when deploy mode is 'domain'", () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        VIBE_DEPLOY_MODE: "domain",
        VIBE_TLS_EMAIL: "ops@example.com",
      }),
    ).toThrow(/VIBE_DOMAIN/);
  });

  it("requires VIBE_TLS_EMAIL when deploy mode is 'domain'", () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        VIBE_DEPLOY_MODE: "domain",
        VIBE_DOMAIN: "calc.example.com",
      }),
    ).toThrow(/VIBE_TLS_EMAIL/);
  });

  it("accepts a valid 'domain' deploy with both fields set", () => {
    const env = parseEnv({
      ...baseEnv,
      VIBE_DEPLOY_MODE: "domain",
      VIBE_DOMAIN: "calc.example.com",
      VIBE_TLS_EMAIL: "ops@example.com",
    });
    expect(env.VIBE_DOMAIN).toBe("calc.example.com");
    expect(env.VIBE_TLS_EMAIL).toBe("ops@example.com");
  });

  it("does not require domain fields for the 'tailscale' mode", () => {
    expect(() => parseEnv({ ...baseEnv, VIBE_DEPLOY_MODE: "tailscale" })).not.toThrow();
  });

  it("coerces PORT from a string", () => {
    expect(parseEnv({ ...baseEnv, PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => parseEnv({ ...baseEnv, PORT: "abc" })).toThrow(EnvValidationError);
  });

  it("rejects a negative PORT", () => {
    expect(() => parseEnv({ ...baseEnv, PORT: "-1" })).toThrow(EnvValidationError);
  });
});
