import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { users } from "@vibe-calc/db";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/password.js";
import { createKms } from "../lib/kms.js";
import { sealerFrom } from "../lib/totp.js";
import { createRateLimiter, memoryStore } from "../lib/rate-limit.js";
import { createSession } from "../lib/sessions.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";

/**
 * Admin → Email settings round-trip. Confirms that:
 *   - GET on a fresh DB returns the singleton row with all secrets null
 *   - PUT seals the SMTP password and stores other fields verbatim
 *   - GET after PUT redacts the password to a 4-char prefix (never the
 *     plaintext) and surfaces the other fields
 *   - PUT clearSmtpPass: true wipes the sealed value
 *   - POST /test against an unconfigured provider returns 503
 */

interface AppHarness {
  db: TestDb;
  app: Express;
  adminCookie: string;
}

async function buildAppHarness(db: TestDb): Promise<AppHarness> {
  const env = { VIBE_DEPLOY_MODE: "lan" as const };
  const testKms = createKms(randomBytes(32).toString("base64"));
  const app = createApp({
    auth: {
      middleware: { db, env },
      routes: {
        db,
        env,
        rateLimiter: createRateLimiter(memoryStore()),
        totpSealer: sealerFrom(testKms),
        kms: testKms,
        emitMagicLinkEmail: () => undefined,
        resolveEmailProvider: async () => null,
      },
    },
  });
  const [admin] = await db
    .insert(users)
    .values({
      email: "admin@firm.test",
      name: "Admin",
      role: "admin",
      status: "active",
      passwordHash: await hashPassword("Trombone-glacier-7!quiet-river2026"),
    })
    .returning();
  const session = await createSession(db, { userId: admin!.id });
  const adminCookie = `${SESSION_COOKIE_NAME}=${session.token}`;
  return { db, app, adminCookie };
}

describe("admin email settings — integration", () => {
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
    h = await buildAppHarness(harness.db);
  });

  it("fresh DB → all secrets null, no active provider", async () => {
    const r = await request(h.app).get("/api/v1/admin/email/settings").set("Cookie", h.adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.settings.activeProvider).toBeNull();
    expect(r.body.settings.smtpPassPrefix).toBeNull();
    expect(r.body.settings.postmarkTokenPrefix).toBeNull();
    expect(r.body.settings.emailitKeyPrefix).toBeNull();
  });

  it("PUT smtp creds → GET returns redacted prefix, never plaintext", async () => {
    const put = await request(h.app)
      .put("/api/v1/admin/email/settings")
      .set("Cookie", h.adminCookie)
      .send({
        activeProvider: "smtp",
        smtpHost: "smtp.example.test",
        smtpPort: 587,
        smtpUser: "apikey",
        smtpPass: "supersecret-1234567890",
        smtpSecure: false,
        smtpFrom: "noreply@firm.test",
      });
    expect(put.status).toBe(204);

    const get = await request(h.app)
      .get("/api/v1/admin/email/settings")
      .set("Cookie", h.adminCookie);
    expect(get.status).toBe(200);
    expect(get.body.settings.activeProvider).toBe("smtp");
    expect(get.body.settings.smtpHost).toBe("smtp.example.test");
    expect(get.body.settings.smtpPort).toBe(587);
    expect(get.body.settings.smtpUser).toBe("apikey");
    expect(get.body.settings.smtpFrom).toBe("noreply@firm.test");
    // Critical: never echo plaintext.
    expect(get.body.settings.smtpPassPrefix).toBe("supe…");
    expect(JSON.stringify(get.body)).not.toContain("supersecret-1234567890");
  });

  it("clearSmtpPass: true wipes the sealed value", async () => {
    await request(h.app)
      .put("/api/v1/admin/email/settings")
      .set("Cookie", h.adminCookie)
      .send({
        activeProvider: "smtp",
        smtpHost: "smtp.example.test",
        smtpPort: 587,
        smtpUser: "u",
        smtpPass: "x".repeat(20),
        smtpFrom: "n@firm.test",
      });
    const before = await request(h.app)
      .get("/api/v1/admin/email/settings")
      .set("Cookie", h.adminCookie);
    expect(before.body.settings.smtpPassPrefix).not.toBeNull();

    await request(h.app)
      .put("/api/v1/admin/email/settings")
      .set("Cookie", h.adminCookie)
      .send({ activeProvider: "smtp", clearSmtpPass: true });

    const after = await request(h.app)
      .get("/api/v1/admin/email/settings")
      .set("Cookie", h.adminCookie);
    expect(after.body.settings.smtpPassPrefix).toBeNull();
  });

  it("POST /test with no configured provider returns 503", async () => {
    const r = await request(h.app)
      .post("/api/v1/admin/email/test")
      .set("Cookie", h.adminCookie)
      .send({ to: "you@firm.test" });
    expect(r.status).toBe(503);
    expect(r.body.detail).toMatch(/No email provider configured/i);
  });

  it("non-admin rejected by settings:write permission", async () => {
    const [preparer] = await harness.db
      .insert(users)
      .values({
        email: "prep@firm.test",
        name: "Prep",
        role: "preparer",
        status: "active",
        passwordHash: await hashPassword("Trombone-glacier-7!quiet-river2026"),
      })
      .returning();
    const session = await createSession(harness.db, { userId: preparer!.id });
    const cookie = `${SESSION_COOKIE_NAME}=${session.token}`;

    const r = await request(h.app).get("/api/v1/admin/email/settings").set("Cookie", cookie);
    expect(r.status).toBe(403);
  });
});
