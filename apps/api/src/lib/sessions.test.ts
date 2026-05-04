import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  ABSOLUTE_TTL_MS,
  ROLLING_TTL_MS,
  SESSION_COOKIE_NAME,
  generateSessionId,
} from "./sessions.js";
import { clearSessionCookie, refreshSessionCookie, setSessionCookie } from "./cookies.js";

describe("session model constants", () => {
  it("rolling TTL is 30 days", () => {
    expect(ROLLING_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("absolute TTL is 90 days", () => {
    expect(ABSOLUTE_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("cookie name is the appliance-namespaced 'vibecalc_sid'", () => {
    expect(SESSION_COOKIE_NAME).toBe("vibecalc_sid");
  });
});

describe("generateSessionId", () => {
  it("emits 64 lowercase hex chars (32 random bytes)", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("yields different ids on consecutive calls", () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });
});

function appWithRoute(handler: express.RequestHandler): express.Express {
  const app = express();
  app.get("/probe", handler);
  return app;
}

describe("setSessionCookie", () => {
  it("emits HttpOnly + SameSite=Lax cookie", async () => {
    const app = appWithRoute((_req, res) => {
      setSessionCookie(res, "deadbeef".repeat(8), { deployMode: "lan" });
      res.json({ ok: true });
    });
    const r = await request(app).get("/probe");
    const cookie = r.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^vibecalc_sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    // lan mode: Secure flag must NOT be present (plaintext HTTP)
    expect(cookie).not.toMatch(/Secure/);
  });

  it("only sets Secure when deploy mode is 'domain'", async () => {
    const app = appWithRoute((_req, res) => {
      setSessionCookie(res, "x".repeat(64), { deployMode: "domain" });
      res.json({ ok: true });
    });
    const r = await request(app).get("/probe");
    const cookie = r.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/Secure/);
  });

  it("tailscale mode runs plain HTTP behind tailscale serve — no Secure flag", async () => {
    const app = appWithRoute((_req, res) => {
      setSessionCookie(res, "x".repeat(64), { deployMode: "tailscale" });
      res.json({ ok: true });
    });
    const r = await request(app).get("/probe");
    const cookie = r.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).not.toMatch(/Secure/);
  });

  it("uses path=/ and Max-Age matches the rolling TTL", async () => {
    const app = appWithRoute((_req, res) => {
      setSessionCookie(res, "x".repeat(64), { deployMode: "lan" });
      res.json({ ok: true });
    });
    const r = await request(app).get("/probe");
    const cookie = r.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/); // 30 * 86400
  });
});

describe("clearSessionCookie", () => {
  it("emits a Set-Cookie that empties the value (express does the rest)", async () => {
    const app = appWithRoute((_req, res) => {
      clearSessionCookie(res, { deployMode: "lan" });
      res.json({ ok: true });
    });
    const r = await request(app).get("/probe");
    const cookie = r.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^vibecalc_sid=;/);
  });
});

describe("refreshSessionCookie", () => {
  it("re-sets the same cookie attributes (idempotent extend)", async () => {
    const app = appWithRoute((_req, res) => {
      refreshSessionCookie(res, "x".repeat(64), { deployMode: "lan" });
      res.json({ ok: true });
    });
    const r = await request(app).get("/probe");
    const cookie = r.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^vibecalc_sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=2592000/);
  });
});
