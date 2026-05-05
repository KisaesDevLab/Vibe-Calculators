import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { users } from "@vibe-calc/db";
import type { EmailProvider, SendInput, SendResult } from "@vibe-calc/email";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/password.js";
import { createKms } from "../lib/kms.js";
import { sealerFrom } from "../lib/totp.js";
import { createRateLimiter, memoryStore } from "../lib/rate-limit.js";
import { createSession } from "../lib/sessions.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";
import { syncAfr } from "../lib/afr-update.js";
import { nextRunAt } from "../lib/schedule-tick.js";

class MockProvider implements EmailProvider {
  readonly name = "mock";
  readonly sent: SendInput[] = [];
  async send(input: SendInput): Promise<SendResult> {
    this.sent.push(input);
    return { messageId: `mock-${Math.random().toString(36).slice(2)}`, provider: this.name };
  }
}

interface AppHarness {
  db: TestDb;
  app: Express;
  mock: MockProvider;
}

function buildAppHarness(db: TestDb): AppHarness {
  const env = { VIBE_DEPLOY_MODE: "lan" as const };
  const testKms = createKms(randomBytes(32).toString("base64"));
  const mock = new MockProvider();
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
        emailProvider: mock,
      },
    },
  });
  return { db, app, mock };
}

async function seedUser(
  db: TestDb,
  fields: { email: string; name: string; role: "admin" | "preparer" | "readonly" },
): Promise<{ id: string }> {
  const row = await db
    .insert(users)
    .values({
      email: fields.email,
      name: fields.name,
      role: fields.role,
      status: "active",
      passwordHash: await hashPassword("Trombone-glacier-7!quiet-river2026"),
    })
    .returning();
  return { id: row[0]!.id };
}

async function cookie(db: TestDb, userId: string): Promise<string> {
  const s = await createSession(db, { userId });
  return `${SESSION_COOKIE_NAME}=${s.token}`;
}

describe("schedules — integration", () => {
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

  it("nextRunAt advances by cadence", () => {
    const now = new Date("2025-06-15T09:00:00Z");
    expect(nextRunAt("daily", now)?.toISOString()).toBe("2025-06-16T09:00:00.000Z");
    expect(nextRunAt("weekly", now)?.toISOString()).toBe("2025-06-22T09:00:00.000Z");
    expect(nextRunAt("monthly", now)?.toISOString()).toBe("2025-07-15T09:00:00.000Z");
    expect(nextRunAt("quarterly", now)?.toISOString()).toBe("2025-09-15T09:00:00.000Z");
    expect(nextRunAt("annually", now)?.toISOString()).toBe("2026-06-15T09:00:00.000Z");
    expect(nextRunAt("once", now)).toBeNull();
  });

  it("create schedule, run-now sends to mock provider, instance recorded", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookie(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "C", entityType: "individual" });
    const calc = await request(h.app).post("/api/v1/calculations").set("Cookie", c).send({
      name: "Quarterly tax projection",
      kind: "tax.safe_harbor",
      clientId: cl.body.client.id,
      inputs: {},
    });

    const sched = await request(h.app).post("/api/v1/schedules").set("Cookie", c).send({
      calculationId: calc.body.calculation.id,
      cadence: "monthly",
      recipients: "cpa@firm.test",
      subject: "Monthly: {{calc.name}} on {{run.date}}",
    });
    expect(sched.status).toBe(201);

    const run = await request(h.app)
      .post(`/api/v1/schedules/${sched.body.schedule.id}/run-now`)
      .set("Cookie", c);
    expect(run.status).toBe(200);
    expect(run.body.instance.status).toBe("delivered");

    expect(h.mock.sent).toHaveLength(1);
    expect(h.mock.sent[0]?.subject).toContain("Quarterly tax projection");
    expect(h.mock.sent[0]?.metadata?.scheduleId).toBe(sched.body.schedule.id);
  });

  it("readonly user cannot create a schedule", async () => {
    const ro = await seedUser(h.db, { email: "ro@firm.test", name: "R", role: "readonly" });
    const c = await cookie(h.db, ro.id);
    const r = await request(h.app).post("/api/v1/schedules").set("Cookie", c).send({
      calculationId: "any",
      cadence: "daily",
      recipients: "a@b.com",
      subject: "X",
    });
    expect(r.status).toBe(403);
  });

  it("pause/resume toggles schedule status", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookie(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "Y", entityType: "individual" });
    const calc = await request(h.app)
      .post("/api/v1/calculations")
      .set("Cookie", c)
      .send({ name: "X", kind: "tvm.amortization", clientId: cl.body.client.id, inputs: {} });
    const sched = await request(h.app).post("/api/v1/schedules").set("Cookie", c).send({
      calculationId: calc.body.calculation.id,
      cadence: "weekly",
      recipients: "a@b.com",
      subject: "X",
    });

    await request(h.app).post(`/api/v1/schedules/${sched.body.schedule.id}/pause`).set("Cookie", c);
    const det = await request(h.app)
      .get(`/api/v1/schedules/${sched.body.schedule.id}`)
      .set("Cookie", c);
    expect(det.body.schedule.status).toBe("paused");

    await request(h.app)
      .post(`/api/v1/schedules/${sched.body.schedule.id}/resume`)
      .set("Cookie", c);
    const det2 = await request(h.app)
      .get(`/api/v1/schedules/${sched.body.schedule.id}`)
      .set("Cookie", c);
    expect(det2.body.schedule.status).toBe("active");
  });

  it("AFR sync inserts a row when none exists, idempotent on re-run", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    void admin;
    const stub = async () => ({
      shortTermAnnual: 0.0445,
      midTermAnnual: 0.0467,
      longTermAnnual: 0.0488,
      effectiveMonth: "2025-06",
      sourceUrl: "https://www.irs.gov/pub/irs-drop/rr-25-12.pdf",
      sourceVersion: "Rev. Rul. 2025-12",
    });

    const r1 = await syncAfr(h.db, { fetcher: stub });
    expect(r1.inserted).toBe(true);

    const r2 = await syncAfr(h.db, { fetcher: stub });
    expect(r2.inserted).toBe(false);
    expect(r2.id).toBe(r1.id);
  });
});
