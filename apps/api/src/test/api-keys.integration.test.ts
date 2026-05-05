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
import { dispatchWebhook, verifyWebhookSignature } from "../lib/webhook-dispatch.js";

interface AppHarness {
  db: TestDb;
  app: Express;
  testKms: ReturnType<typeof createKms>;
}

function buildAppHarness(db: TestDb): AppHarness {
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
      },
    },
  });
  return { db, app, testKms };
}

async function seedAdmin(db: TestDb): Promise<{ id: string }> {
  const r = await db
    .insert(users)
    .values({
      email: "a@firm.test",
      name: "Admin",
      role: "admin",
      status: "active",
      passwordHash: await hashPassword("Trombone-glacier-7!quiet-river2026"),
    })
    .returning();
  return { id: r[0]!.id };
}

async function cookie(db: TestDb, userId: string): Promise<string> {
  const s = await createSession(db, { userId });
  return `${SESSION_COOKIE_NAME}=${s.token}`;
}

describe("API keys + webhooks — integration", () => {
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

  it("admin issues an API key, then bearer auth succeeds against /api/v1/clients", async () => {
    const admin = await seedAdmin(h.db);
    const c = await cookie(h.db, admin.id);

    const issue = await request(h.app)
      .post("/api/v1/admin/api-keys")
      .set("Cookie", c)
      .send({ name: "CI", scopes: [] });
    expect(issue.status).toBe(201);
    const plaintext = issue.body.plaintext as string;
    expect(plaintext.startsWith("vibe_")).toBe(true);

    // Auth via bearer (no cookie):
    const list = await request(h.app)
      .get("/api/v1/clients")
      .set("Authorization", `Bearer ${plaintext}`);
    expect(list.status).toBe(200);
  });

  it("revoked keys cannot authenticate", async () => {
    const admin = await seedAdmin(h.db);
    const c = await cookie(h.db, admin.id);
    const issue = await request(h.app)
      .post("/api/v1/admin/api-keys")
      .set("Cookie", c)
      .send({ name: "CI" });
    const plaintext = issue.body.plaintext as string;

    await request(h.app)
      .post(`/api/v1/admin/api-keys/${issue.body.apiKey.id}/revoke`)
      .set("Cookie", c);

    const list = await request(h.app)
      .get("/api/v1/clients")
      .set("Authorization", `Bearer ${plaintext}`);
    expect(list.status).toBe(401);
  });

  it("OpenAPI spec is publicly served", async () => {
    const r = await request(h.app).get("/api/v1/openapi.json");
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe("3.0.3");
    expect(r.body.paths["/clients"]).toBeDefined();
  });

  it("webhook dispatcher fires only matching subscriptions and signs the body", async () => {
    const admin = await seedAdmin(h.db);
    const c = await cookie(h.db, admin.id);
    let receivedBody = "";
    let receivedSig = "";

    const create = await request(h.app)
      .post("/api/v1/webhooks")
      .set("Cookie", c)
      .send({
        name: "test",
        url: "https://example.test/hook",
        actions: ["calculation.create"],
      });
    expect(create.status).toBe(201);
    const secret = create.body.secret as string;

    const stubFetch: typeof fetch = async (_url, init) => {
      receivedBody = String(init?.body ?? "");
      receivedSig = String((init?.headers as Record<string, string>)?.["X-Vibe-Signature"] ?? "");
      return new Response("ok", { status: 200 });
    };

    // Matching action — pass `unsealSecret` so the dispatcher can
    // unwrap the KMS-sealed envelope stored on the row (H8).
    const match = await dispatchWebhook(h.db, {
      action: "calculation.create",
      entityKind: "calculation",
      entityId: "abc",
      payload: { hello: "world" },
      fetcher: stubFetch,
      unsealSecret: (s) => h.testKms.decrypt(s),
    });
    expect(match.fired).toBe(1);
    expect(match.successes).toBe(1);
    expect(verifyWebhookSignature(secret, receivedBody, receivedSig)).toBe(true);

    // Non-matching action — sub has filter ["calculation.create"]
    const noMatch = await dispatchWebhook(h.db, {
      action: "engagement.assign",
      entityKind: "engagement",
      entityId: "xyz",
      fetcher: stubFetch,
      unsealSecret: (s) => h.testKms.decrypt(s),
    });
    expect(noMatch.fired).toBe(0);
  });
});
