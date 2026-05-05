import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditEvents, users } from "@vibe-calc/db";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/password.js";
import { createKms } from "../lib/kms.js";
import { sealerFrom } from "../lib/totp.js";
import { createRateLimiter, memoryStore } from "../lib/rate-limit.js";
import { createSession } from "../lib/sessions.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";

interface AppHarness {
  db: TestDb;
  app: Express;
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
  return { db, app };
}

async function seedUser(
  db: TestDb,
  fields: { email: string; name: string; role: "admin" | "reviewer" | "preparer" | "readonly" },
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

describe("versioning + audit chain — integration", () => {
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

  it("save creates a new immutable version and bumps the pointer", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookie(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "C", entityType: "individual" });
    const create = await request(h.app)
      .post("/api/v1/calculations")
      .set("Cookie", c)
      .send({
        name: "Loan A",
        kind: "tvm.amortization",
        clientId: cl.body.client.id,
        inputs: { rate: 0.07 },
      });
    const id = create.body.calculation.id as string;

    const save1 = await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", c)
      .send({ inputs: { rate: 0.08 }, outputs: { payment: 1000 } });
    expect(save1.status).toBe(200);
    expect(save1.body.calculation.version).toBe(2);

    const save2 = await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", c)
      .send({ inputs: { rate: 0.09 } });
    expect(save2.body.calculation.version).toBe(3);

    const versions = await request(h.app)
      .get(`/api/v1/calculations/${id}/versions`)
      .set("Cookie", c);
    expect(versions.body.versions).toHaveLength(2);
    expect(versions.body.versions[0].version).toBe(3);
  });

  it("rollback creates a new version (does not overwrite)", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookie(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "Z", entityType: "individual" });
    const create = await request(h.app)
      .post("/api/v1/calculations")
      .set("Cookie", c)
      .send({
        name: "X",
        kind: "tvm.amortization",
        clientId: cl.body.client.id,
        inputs: { v: 1 },
      });
    const id = create.body.calculation.id as string;

    await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", c)
      .send({ inputs: { v: 2 } });
    await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", c)
      .send({ inputs: { v: 3 } });
    const versions = await request(h.app)
      .get(`/api/v1/calculations/${id}/versions`)
      .set("Cookie", c);
    const v2 = versions.body.versions.find((r: { version: number }) => r.version === 2);
    expect(v2).toBeTruthy();

    const rollback = await request(h.app)
      .post(`/api/v1/calculations/${id}/rollback`)
      .set("Cookie", c)
      .send({ versionId: v2.id });
    expect(rollback.status).toBe(200);
    expect(rollback.body.calculation.version).toBe(4);
    expect(rollback.body.version.inputsJson.v).toBe(2);
  });

  it("approve locks the version; preparer cannot approve; reject returns to draft", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const reviewer = await seedUser(h.db, { email: "r@firm.test", name: "R", role: "reviewer" });
    const preparer = await seedUser(h.db, { email: "p@firm.test", name: "P", role: "preparer" });
    const aC = await cookie(h.db, admin.id);
    const rC = await cookie(h.db, reviewer.id);
    const pC = await cookie(h.db, preparer.id);

    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", aC)
      .send({ name: "Y", entityType: "individual" });
    // Create engagement and assign preparer + reviewer so the IDOR
    // ownership scoping (lib/ownership.ts) lets them act on the calc.
    const eng = await request(h.app)
      .post("/api/v1/engagements")
      .set("Cookie", aC)
      .send({ clientId: cl.body.client.id, name: "FY-test" });
    await request(h.app)
      .post(`/api/v1/engagements/${eng.body.engagement.id}/assign`)
      .set("Cookie", aC)
      .send({ preparerId: preparer.id, reviewerId: reviewer.id });
    const calc = await request(h.app).post("/api/v1/calculations").set("Cookie", aC).send({
      name: "Q",
      kind: "tvm.amortization",
      clientId: cl.body.client.id,
      engagementId: eng.body.engagement.id,
      inputs: {},
    });
    const id = calc.body.calculation.id as string;
    await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", aC)
      .send({ inputs: { v: 1 } });

    // Preparer submits for review
    const submit = await request(h.app)
      .post(`/api/v1/calculations/${id}/submit-for-review`)
      .set("Cookie", pC);
    expect(submit.status).toBe(200);
    expect(submit.body.calculation.status).toBe("ready_for_review");

    // Preparer cannot approve
    const cantApprove = await request(h.app)
      .post(`/api/v1/calculations/${id}/approve`)
      .set("Cookie", pC);
    expect(cantApprove.status).toBe(403);

    // Reviewer approves
    const approve = await request(h.app)
      .post(`/api/v1/calculations/${id}/approve`)
      .set("Cookie", rC);
    expect(approve.status).toBe(200);
    expect(approve.body.calculation.status).toBe("approved");

    // Saving an approved calc is rejected
    const blockedSave = await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", aC)
      .send({ inputs: { v: 99 } });
    expect(blockedSave.status).toBe(409);

    // Versions show the most recent locked
    const versions = await request(h.app)
      .get(`/api/v1/calculations/${id}/versions`)
      .set("Cookie", aC);
    expect(versions.body.versions[0].lockedAt).not.toBeNull();
  });

  it("reject sends calc back to draft and stores reason as a comment", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const reviewer = await seedUser(h.db, { email: "r@firm.test", name: "R", role: "reviewer" });
    const aC = await cookie(h.db, admin.id);
    const rC = await cookie(h.db, reviewer.id);

    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", aC)
      .send({ name: "K", entityType: "individual" });
    const eng = await request(h.app)
      .post("/api/v1/engagements")
      .set("Cookie", aC)
      .send({ clientId: cl.body.client.id, name: "FY-test" });
    await request(h.app)
      .post(`/api/v1/engagements/${eng.body.engagement.id}/assign`)
      .set("Cookie", aC)
      .send({ reviewerId: reviewer.id });
    const calc = await request(h.app).post("/api/v1/calculations").set("Cookie", aC).send({
      name: "Calc",
      kind: "tvm.amortization",
      clientId: cl.body.client.id,
      engagementId: eng.body.engagement.id,
      inputs: {},
    });
    const id = calc.body.calculation.id as string;
    await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", aC)
      .send({ inputs: { v: 1 } });
    await request(h.app).post(`/api/v1/calculations/${id}/submit-for-review`).set("Cookie", aC);

    const reject = await request(h.app)
      .post(`/api/v1/calculations/${id}/reject`)
      .set("Cookie", rC)
      .send({ reason: "Inputs missing tax-year basis." });
    expect(reject.status).toBe(200);
    expect(reject.body.calculation.status).toBe("draft");

    const comments = await request(h.app)
      .get(`/api/v1/calculations/${id}/comments`)
      .set("Cookie", aC);
    expect(comments.body.comments).toHaveLength(1);
    expect(comments.body.comments[0].body).toContain("tax-year basis");
  });

  it("IDOR: an unrelated preparer is rejected with 404 when accessing a calc not in their scope", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const stranger = await seedUser(h.db, {
      email: "stranger@firm.test",
      name: "Stranger",
      role: "preparer",
    });
    const aC = await cookie(h.db, admin.id);
    const sC = await cookie(h.db, stranger.id);

    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", aC)
      .send({ name: "Confidential Co", entityType: "c_corp" });
    const calc = await request(h.app).post("/api/v1/calculations").set("Cookie", aC).send({
      name: "Sensitive",
      kind: "tvm.amortization",
      clientId: cl.body.client.id,
      inputs: {},
    });
    const id = calc.body.calculation.id as string;

    // Stranger preparer is not assigned to any engagement and did not
    // create the calc — every endpoint must 404 (not 403, to avoid
    // leaking existence).
    expect((await request(h.app).get(`/api/v1/calculations/${id}`).set("Cookie", sC)).status).toBe(
      404,
    );
    expect(
      (
        await request(h.app)
          .post(`/api/v1/calculations/${id}/save`)
          .set("Cookie", sC)
          .send({ inputs: { v: 1 } })
      ).status,
    ).toBe(404);
    expect(
      (await request(h.app).get(`/api/v1/calculations/${id}/versions`).set("Cookie", sC)).status,
    ).toBe(404);
    expect(
      (await request(h.app).post(`/api/v1/calculations/${id}/archive`).set("Cookie", sC)).status,
    ).toBe(404);

    // Bulk archive: stranger's id list is silently filtered to empty.
    const bulk = await request(h.app)
      .post("/api/v1/bulk/calculations/archive")
      .set("Cookie", sC)
      .send({ ids: [id] });
    expect(bulk.status).toBe(200);
    expect(bulk.body.updatedIds).toEqual([]);
  });

  it("audit chain: every action records an event, validator passes intact chain, breaks on tamper", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookie(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "Audit Co", entityType: "c_corp" });
    const calc = await request(h.app)
      .post("/api/v1/calculations")
      .set("Cookie", c)
      .send({ name: "X", kind: "tvm.amortization", clientId: cl.body.client.id, inputs: {} });
    const id = calc.body.calculation.id as string;
    await request(h.app)
      .post(`/api/v1/calculations/${id}/save`)
      .set("Cookie", c)
      .send({ inputs: { v: 1 } });
    await request(h.app).post(`/api/v1/calculations/${id}/submit-for-review`).set("Cookie", c);

    // Validate chain
    const validate = await request(h.app).get("/api/v1/audit/chain/validate").set("Cookie", c);
    expect(validate.status).toBe(200);
    expect(validate.body.ok).toBe(true);
    expect(validate.body.rowsChecked).toBeGreaterThan(0);

    // Per-entity replay
    const events = await request(h.app)
      .get(`/api/v1/audit/events/by-entity/calculation/${id}`)
      .set("Cookie", c);
    const actions = (events.body.events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("calculation.save");
    expect(actions).toContain("calculation.submit_for_review");

    // Tamper: hand-modify a payload row → validate must report break.
    const [row] = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "calculation.save"))
      .limit(1);
    expect(row).toBeTruthy();
    await h.db
      .update(auditEvents)
      .set({ payload: { tampered: true } })
      .where(eq(auditEvents.id, row!.id));

    const broken = await request(h.app).get("/api/v1/audit/chain/validate").set("Cookie", c);
    expect(broken.body.ok).toBe(false);
    expect(broken.body.reason).toBe("row-hash-mismatch");
  });
});
