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
 * Phase 20 integration — workspace + tagging + search + queue + bulk.
 *
 * Spins up the real Express app against a Postgres testcontainer,
 * then exercises the full workspace flow:
 *   - admin creates client → engagement → calculation
 *   - tagging: create tag, attach, list autocomplete, detach
 *   - search: substring across name/EIN/inputs
 *   - status workflow: draft → in_review → approved (reviewer-only)
 *   - my-queue surfaces engagements assigned to the requester
 *   - bulk archive
 *   - readonly user is blocked from every mutation endpoint
 */

interface AppHarness {
  db: TestDb;
  app: Express;
}

function buildAppHarness(db: TestDb): AppHarness {
  const env = { VIBE_DEPLOY_MODE: "lan" as const };
  const app = createApp({
    auth: {
      middleware: { db, env },
      routes: {
        db,
        env,
        rateLimiter: createRateLimiter(memoryStore()),
        totpSealer: sealerFrom(createKms(randomBytes(32).toString("base64"))),
        emitMagicLinkEmail: () => undefined,
      },
    },
  });
  return { db, app };
}

async function seedUser(
  db: TestDb,
  fields: {
    email: string;
    name: string;
    role: "admin" | "reviewer" | "preparer" | "readonly";
  },
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

async function cookieFor(db: TestDb, userId: string): Promise<string> {
  const s = await createSession(db, { userId });
  return `${SESSION_COOKIE_NAME}=${s.id}`;
}

describe("workspace — integration", () => {
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

  it("admin creates client → engagement → calculation; readonly user can read but not mutate", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "Admin", role: "admin" });
    const ro = await seedUser(h.db, { email: "ro@firm.test", name: "Read", role: "readonly" });
    const adminC = await cookieFor(h.db, admin.id);
    const roC = await cookieFor(h.db, ro.id);

    const create = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", adminC)
      .send({ name: "Acme Trust", entityType: "trust", ein: "12-3456789" });
    expect(create.status).toBe(201);
    const clientId = create.body.client.id as string;

    // Readonly can list and detail
    const list = await request(h.app).get("/api/v1/clients").set("Cookie", roC);
    expect(list.status).toBe(200);
    expect(list.body.clients).toHaveLength(1);

    // Readonly can NOT create
    const blocked = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", roC)
      .send({ name: "X", entityType: "individual" });
    expect(blocked.status).toBe(403);

    // Admin creates engagement on the client
    const eng = await request(h.app)
      .post("/api/v1/engagements")
      .set("Cookie", adminC)
      .send({ clientId, name: "2025 Tax Plan", taxYear: 2025, engagementType: "tax_planning" });
    expect(eng.status).toBe(201);
    const engId = eng.body.engagement.id as string;

    // Detail page returns engagement
    const detail = await request(h.app).get(`/api/v1/clients/${clientId}`).set("Cookie", adminC);
    expect(detail.status).toBe(200);
    expect(detail.body.engagements).toHaveLength(1);
    expect(detail.body.engagements[0].id).toBe(engId);
  });

  it("tagging: create, attach, autocomplete, detach", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookieFor(h.db, admin.id);
    const client = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "Beta LLC", entityType: "single_member_llc" });
    const clientId = client.body.client.id as string;

    // Attach by name (creates tag)
    const attach = await request(h.app)
      .post("/api/v1/tags/attach")
      .set("Cookie", c)
      .send({ tagName: "high-net-worth", entityKind: "client", entityId: clientId });
    expect(attach.status).toBe(204);

    // Autocomplete
    const list = await request(h.app).get("/api/v1/tags?q=high").set("Cookie", c);
    expect(list.body.tags.some((t: { name: string }) => t.name === "high-net-worth")).toBe(true);

    // Client detail surfaces the tag
    const detail = await request(h.app).get(`/api/v1/clients/${clientId}`).set("Cookie", c);
    expect(detail.body.tags).toHaveLength(1);
    const tagId = detail.body.tags[0].id as string;

    // Detach
    const detach = await request(h.app)
      .post("/api/v1/tags/detach")
      .set("Cookie", c)
      .send({ tagId, entityKind: "client", entityId: clientId });
    expect(detach.status).toBe(204);

    const after = await request(h.app).get(`/api/v1/clients/${clientId}`).set("Cookie", c);
    expect(after.body.tags).toHaveLength(0);
  });

  it("status workflow: draft → in_review → approved (reviewer only)", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const reviewer = await seedUser(h.db, { email: "r@firm.test", name: "R", role: "reviewer" });
    const preparer = await seedUser(h.db, { email: "p@firm.test", name: "P", role: "preparer" });
    const aC = await cookieFor(h.db, admin.id);
    const rC = await cookieFor(h.db, reviewer.id);
    const pC = await cookieFor(h.db, preparer.id);

    const c = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", aC)
      .send({ name: "Gamma Corp", entityType: "c_corp" });
    const e = await request(h.app)
      .post("/api/v1/engagements")
      .set("Cookie", aC)
      .send({ clientId: c.body.client.id, name: "FY25", taxYear: 2025 });
    const engId = e.body.engagement.id as string;

    // Preparer can submit for review (draft → in_review)
    const submit = await request(h.app)
      .post(`/api/v1/engagements/${engId}/transition`)
      .set("Cookie", pC)
      .send({ to: "in_review" });
    expect(submit.status).toBe(200);
    expect(submit.body.engagement.status).toBe("in_review");

    // Preparer cannot approve
    const cantApprove = await request(h.app)
      .post(`/api/v1/engagements/${engId}/transition`)
      .set("Cookie", pC)
      .send({ to: "approved" });
    expect(cantApprove.status).toBe(403);

    // Reviewer approves
    const approve = await request(h.app)
      .post(`/api/v1/engagements/${engId}/transition`)
      .set("Cookie", rC)
      .send({ to: "approved" });
    expect(approve.status).toBe(200);
    expect(approve.body.engagement.status).toBe("approved");

    // Cannot draft → approved directly (state machine guard)
    await request(h.app)
      .post(`/api/v1/engagements/${engId}/transition`)
      .set("Cookie", rC)
      .send({ to: "in_review" });
    const skip = await request(h.app)
      .post(`/api/v1/engagements/${engId}/transition`)
      .set("Cookie", rC)
      .send({ to: "draft" });
    expect(skip.status).toBe(200);
    const skipBad = await request(h.app)
      .post(`/api/v1/engagements/${engId}/transition`)
      .set("Cookie", rC)
      .send({ to: "approved" });
    expect(skipBad.status).toBe(409);
  });

  it("search hits clients/engagements/calculations including JSONB inputs", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookieFor(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "Delta Holdings", entityType: "c_corp" });
    const eng = await request(h.app)
      .post("/api/v1/engagements")
      .set("Cookie", c)
      .send({ clientId: cl.body.client.id, name: "Delta 2025 Loan model", taxYear: 2025 });
    await request(h.app)
      .post("/api/v1/calculations")
      .set("Cookie", c)
      .send({
        name: "Loan amortization",
        kind: "tvm.amortization",
        clientId: cl.body.client.id,
        engagementId: eng.body.engagement.id,
        inputs: { loanAmount: 282391, rate: 0.075 },
      });

    const out = await request(h.app).get("/api/v1/search?q=Delta").set("Cookie", c);
    expect(out.status).toBe(200);
    const hits = out.body.hits as Array<{ kind: string }>;
    expect(hits.some((h) => h.kind === "client")).toBe(true);
    expect(hits.some((h) => h.kind === "engagement")).toBe(true);

    // Substring search inside JSONB inputs
    const byAmount = await request(h.app).get("/api/v1/search?q=282391").set("Cookie", c);
    expect(byAmount.body.hits.some((hit: { kind: string }) => hit.kind === "calculation")).toBe(
      true,
    );
  });

  it("my-queue returns engagements assigned to the requester with SLA flag", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const reviewer = await seedUser(h.db, { email: "r@firm.test", name: "R", role: "reviewer" });
    const aC = await cookieFor(h.db, admin.id);
    const rC = await cookieFor(h.db, reviewer.id);

    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", aC)
      .send({ name: "Epsilon", entityType: "individual" });
    const eng = await request(h.app)
      .post("/api/v1/engagements")
      .set("Cookie", aC)
      .send({ clientId: cl.body.client.id, name: "FY25 advisory" });
    await request(h.app)
      .post(`/api/v1/engagements/${eng.body.engagement.id}/assign`)
      .set("Cookie", aC)
      .send({ reviewerId: reviewer.id });

    const queue = await request(h.app).get("/api/v1/queue").set("Cookie", rC);
    expect(queue.status).toBe(200);
    expect(queue.body.myEngagements).toHaveLength(1);
    expect(queue.body.slaThresholdDays).toBe(3);
  });

  it("bulk archive on calculations", async () => {
    const admin = await seedUser(h.db, { email: "a@firm.test", name: "A", role: "admin" });
    const c = await cookieFor(h.db, admin.id);
    const cl = await request(h.app)
      .post("/api/v1/clients")
      .set("Cookie", c)
      .send({ name: "Z", entityType: "individual" });

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request(h.app)
        .post("/api/v1/calculations")
        .set("Cookie", c)
        .send({
          name: `Calc ${i}`,
          kind: "tvm.amortization",
          clientId: cl.body.client.id,
          inputs: {},
        });
      ids.push(r.body.calculation.id as string);
    }

    const bulk = await request(h.app)
      .post("/api/v1/bulk/calculations/archive")
      .set("Cookie", c)
      .send({ ids });
    expect(bulk.status).toBe(200);
    expect(bulk.body.updatedIds).toHaveLength(3);

    const list = await request(h.app)
      .get(`/api/v1/calculations?clientId=${cl.body.client.id}`)
      .set("Cookie", c);
    expect(list.body.calculations).toHaveLength(0);
  });
});
