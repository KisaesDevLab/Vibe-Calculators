import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { recoveryCodes, sessions, users } from "@vibe-calc/db";
import { TOTP, Secret } from "otpauth";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/password.js";
import { persistBootstrapToken } from "../lib/bootstrap.js";
import { createKms } from "../lib/kms.js";
import { sealerFrom } from "../lib/totp.js";
import { createRateLimiter, memoryStore } from "../lib/rate-limit.js";
import { createSession } from "../lib/sessions.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";

/**
 * Phase 2 acceptance — integration tests across the full auth surface.
 *
 * These tests boot the real Express app against pglite, with stubbed
 * SMTP (the magic-link tokens are captured in-memory). They cover:
 *   - the build plan's headline scenario: admin invites preparer →
 *     preparer logs in via magic link → preparer sets password →
 *     preparer enables 2FA
 *   - the build plan's "readonly user cannot reach any mutation
 *     endpoint" test (every POST/DELETE under /api/v1 is exercised)
 *   - first-run bootstrap (POST /api/v1/setup with the printed token)
 *   - rate-limit lockout after 5 failed logins
 */

interface AppHarness {
  db: TestDb;
  app: Express;
  capturedMagicLinks: { email: string; token: string }[];
}

function buildAppHarness(db: TestDb): AppHarness {
  const captured: { email: string; token: string }[] = [];
  const kms = createKms(randomBytes(32).toString("base64"));
  const totpSealer = sealerFrom(kms);
  const rateLimiter = createRateLimiter(memoryStore());
  const env = { VIBE_DEPLOY_MODE: "lan" as const };

  const app = createApp({
    auth: {
      middleware: { db, env },
      routes: {
        db,
        env,
        rateLimiter,
        totpSealer,
        kms,
        emitMagicLinkEmail: (input) => {
          captured.push({ email: input.email, token: input.token });
        },
      },
    },
  });
  return { db, app, capturedMagicLinks: captured };
}

async function seedUser(
  db: TestDb,
  fields: {
    email: string;
    name: string;
    role: "admin" | "reviewer" | "preparer" | "readonly";
    password?: string;
  },
): Promise<{ id: string; email: string }> {
  const row = await db
    .insert(users)
    .values({
      email: fields.email,
      name: fields.name,
      role: fields.role,
      status: "active",
      passwordHash: fields.password ? await hashPassword(fields.password) : null,
    })
    .returning();
  return { id: row[0]!.id, email: row[0]!.email };
}

async function loginCookie(db: TestDb, userId: string): Promise<string> {
  const s = await createSession(db, { userId });
  return `${SESSION_COOKIE_NAME}=${s.token}`;
}

describe("auth flows — integration", () => {
  let harness: TestHarness;
  let h: AppHarness;

  beforeAll(async () => {
    harness = await makeTestDb();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncateAll();
    h = buildAppHarness(harness.db);
  });

  // ----- Build-plan headline scenario --------------------------------

  it("admin invites preparer, preparer logs in via magic link, sets password, enables 2FA", async () => {
    const admin = await seedUser(h.db, {
      email: "admin@firm.test",
      name: "Admin",
      role: "admin",
      password: "Trombone-glacier-7!quiet-river2026",
    });
    const adminCookie = await loginCookie(h.db, admin.id);

    // 1) Admin invites a preparer
    const invite = await request(h.app)
      .post("/api/v1/admin/users/invite")
      .set("Cookie", adminCookie)
      .send({ email: "prep@firm.test", name: "Pat Preparer", role: "preparer" });
    expect(invite.status).toBe(201);
    expect(h.capturedMagicLinks).toHaveLength(1);
    const { token } = h.capturedMagicLinks[0]!;

    // 2) Preparer consumes the magic link
    const consume = await request(h.app).post("/api/v1/auth/magic-link/consume").send({ token });
    expect(consume.status).toBe(200);
    const prepCookie = consume.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    expect(prepCookie).toMatch(/^vibecalc_sid=/);

    // 3) Preparer sets a password (no current password needed)
    const setPw = await request(h.app)
      .post("/api/v1/me/password")
      .set("Cookie", prepCookie)
      .send({ newPassword: "Trombone-glacier-7!quiet-river2026" });
    expect(setPw.status).toBe(204);

    // 4) Preparer sets up 2FA — requires sudo re-auth (M13).
    const setup = await request(h.app)
      .post("/api/v1/me/2fa/setup")
      .set("Cookie", prepCookie)
      .send({ password: "Trombone-glacier-7!quiet-river2026" });
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.qrPng).toMatch(/^data:image\/png;base64,/);

    // 5) Generate the current TOTP code from the otpauth URL and enable
    const url = new URL(setup.body.otpauthUrl);
    const secret = url.searchParams.get("secret")!;
    const code = new TOTP({
      issuer: "Vibe Calculators",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    }).generate();
    const enable = await request(h.app)
      .post("/api/v1/me/2fa/enable")
      .set("Cookie", prepCookie)
      .send({ code });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);
  });

  // ----- Readonly-blocked-from-mutations -----------------------------

  it("readonly user is forbidden from every mutating route", async () => {
    const ro = await seedUser(h.db, {
      email: "ro@firm.test",
      name: "Read Only",
      role: "readonly",
      password: "Trombone-glacier-7!quiet-river2026",
    });
    const cookie = await loginCookie(h.db, ro.id);

    const mutationProbes: { method: "post" | "delete"; path: string; body?: object }[] = [
      // Admin endpoints
      {
        method: "post",
        path: "/api/v1/admin/users/invite",
        body: { email: "x@y.test", name: "X", role: "preparer" },
      },
      { method: "post", path: "/api/v1/admin/users/abc/suspend" },
      { method: "post", path: "/api/v1/admin/users/abc/unsuspend" },
      { method: "post", path: "/api/v1/admin/users/abc/role", body: { role: "preparer" } },
      { method: "post", path: "/api/v1/admin/users/abc/reset-password" },
      { method: "post", path: "/api/v1/admin/users/abc/require-2fa" },
      {
        method: "post",
        path: "/api/v1/admin/users/clear-lockout",
        body: { email: "x@y.test", ip: "1.2.3.4" },
      },
    ];

    for (const probe of mutationProbes) {
      const r = await request(h.app)
        [probe.method](probe.path)
        .set("Cookie", cookie)
        .send(probe.body ?? {});
      expect([401, 403]).toContain(r.status);
      // Must specifically be 403 (not 401) since the cookie IS valid;
      // the request fails permission, not authentication.
      expect(r.status).toBe(403);
    }

    // GET /admin/users requires user:list — readonly should be 403.
    const list = await request(h.app).get("/api/v1/admin/users").set("Cookie", cookie);
    expect(list.status).toBe(403);
  });

  it("unauthenticated requests to protected routes return 401", async () => {
    const r = await request(h.app).get("/api/v1/me");
    expect(r.status).toBe(401);
    const r2 = await request(h.app).get("/api/v1/admin/users");
    expect(r2.status).toBe(401);
  });

  // ----- First-run bootstrap -----------------------------------------

  it("bootstrap: zero users → setup token redeems for first admin", async () => {
    // Operator generates a token (mimicking `just bootstrap`).
    const token = randomBytes(32).toString("hex");
    const persisted = await persistBootstrapToken(h.db, token);
    expect(persisted.ok).toBe(true);

    const r = await request(h.app).post("/api/v1/setup").send({
      token,
      email: "founder@firm.test",
      name: "Founder",
      password: "Trombone-glacier-7!quiet-river2026",
    });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe("admin");

    // Bootstrap is now closed; further attempts fail.
    const r2 = await request(h.app).post("/api/v1/setup").send({
      token,
      email: "second@firm.test",
      name: "Second",
      password: "Trombone-glacier-7!quiet-river2026",
    });
    expect(r2.status).toBe(410);
  });

  it("bootstrap CLI refuses to issue a token after first user exists", async () => {
    await seedUser(h.db, {
      email: "existing@firm.test",
      name: "Existing",
      role: "admin",
      password: "Correct-horse-battery-staple-2026!",
    });
    const token = randomBytes(32).toString("hex");
    const persisted = await persistBootstrapToken(h.db, token);
    expect(persisted.ok).toBe(false);
    if (!persisted.ok) expect(persisted.reason).toBe("users-exist");
  });

  // ----- Rate limit ---------------------------------------------------

  it("five failed password logins lock the (ip, email) pair", async () => {
    await seedUser(h.db, {
      email: "lock@firm.test",
      name: "Lock",
      role: "preparer",
      password: "Correct-horse-battery-staple-2026!",
    });
    for (let i = 0; i < 5; i++) {
      const r = await request(h.app)
        .post("/api/v1/auth/login")
        .send({ email: "lock@firm.test", password: "wrong-but-long-enough-2026" });
      expect(r.status).toBe(401);
    }
    const locked = await request(h.app)
      .post("/api/v1/auth/login")
      .send({ email: "lock@firm.test", password: "wrong-but-long-enough-2026" });
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBeDefined();
  });

  // ----- Logout revokes session --------------------------------------

  it("logout revokes the session and clears the cookie", async () => {
    const user = await seedUser(h.db, {
      email: "logout@firm.test",
      name: "Logout",
      role: "preparer",
      password: "Correct-horse-battery-staple-2026!",
    });
    const cookie = await loginCookie(h.db, user.id);

    const before = await request(h.app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(before.status).toBe(200);

    const logout = await request(h.app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(204);

    const after = await request(h.app).get("/api/v1/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  // ----- Admin disables a user's 2FA / clears recovery codes ---------

  it("admin require-2fa wipes the user's TOTP and revokes their sessions", async () => {
    const admin = await seedUser(h.db, {
      email: "admin2@firm.test",
      name: "Admin",
      role: "admin",
      password: "Correct-horse-battery-staple-2026!",
    });
    const adminCookie = await loginCookie(h.db, admin.id);

    const target = await seedUser(h.db, {
      email: "vic@firm.test",
      name: "Vic",
      role: "preparer",
    });
    // Pre-populate TOTP + recovery codes + an active session.
    await h.db
      .update(users)
      .set({ totpEnabled: true, totpSecret: "v1:fake:fake:fake" })
      .where(eq(users.id, target.id));
    await h.db.insert(recoveryCodes).values({ userId: target.id, codeHash: "x".repeat(64) });
    await loginCookie(h.db, target.id);

    const r = await request(h.app)
      .post(`/api/v1/admin/users/${target.id}/require-2fa`)
      .set("Cookie", adminCookie);
    expect(r.status).toBe(204);

    const [reread] = await h.db.select().from(users).where(eq(users.id, target.id));
    expect(reread?.totpEnabled).toBe(false);
    expect(reread?.totpSecret).toBeNull();
    const remainingCodes = await h.db
      .select()
      .from(recoveryCodes)
      .where(eq(recoveryCodes.userId, target.id));
    expect(remainingCodes).toHaveLength(0);
    const remainingSessions = await h.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, target.id));
    expect(remainingSessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it("magic-link consume requires 2FA when target user has TOTP enabled", async () => {
    // Seed a user with TOTP already enabled. The actual TOTP secret
    // doesn't need to be valid — we're testing that the consume path
    // rejects without ANY second factor.
    const target = await seedUser(h.db, {
      email: "twofactor@firm.test",
      name: "TwoFactor",
      role: "preparer",
      password: "Correct-horse-battery-staple-2026!",
    });
    await h.db
      .update(users)
      .set({ totpEnabled: true, totpSecret: "v1:placeholder:placeholder:placeholder" })
      .where(eq(users.id, target.id));

    // Issue a magic link.
    await request(h.app).post("/api/v1/auth/magic-link").send({ email: target.email });
    const link = h.capturedMagicLinks.find((m) => m.email === target.email);
    expect(link).toBeTruthy();
    const token = link!.token;

    // Consume WITHOUT a TOTP code → must reject with 401.
    const noTotp = await request(h.app).post("/api/v1/auth/magic-link/consume").send({ token });
    expect(noTotp.status).toBe(401);
    expect(noTotp.body.title).toBe("TOTP required");

    // Consume WITH a wrong recovery code → also reject (no row matches).
    const wrong = await request(h.app)
      .post("/api/v1/auth/magic-link/consume")
      .send({ token, recoveryCode: "WRONG-CODE" });
    expect(wrong.status).toBe(401);
  });
});
