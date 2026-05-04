import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { users } from "@vibe-calc/db";
import type { LlmProvider, LlmTextRequest, LlmTextResponse } from "@vibe-calc/llm";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/password.js";
import { createKms } from "../lib/kms.js";
import { sealerFrom } from "../lib/totp.js";
import { createRateLimiter, memoryStore } from "../lib/rate-limit.js";
import { createSession } from "../lib/sessions.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";

class StubProvider implements LlmProvider {
  readonly name = "stub";
  constructor(private readonly out: object) {}
  async generate(_req: LlmTextRequest): Promise<LlmTextResponse> {
    return {
      text: JSON.stringify(this.out),
      responseId: "stub-resp-1",
      model: "stub-model",
      inputTokens: 100,
      outputTokens: 50,
      provider: this.name,
    };
  }
}

const VALID_OUT = {
  borrower: { name: "Acme LLC", address: null },
  lender: { name: "First Bank", address: null },
  principal: 250_000,
  interestRate: 0.075,
  compounding: "monthly",
  termMonths: 360,
  firstPaymentDate: "2025-07-01",
  paymentFrequency: "monthly",
  paymentAmount: 1748.04,
  prepaymentPenalty: false,
  lateFeeNote: null,
  variableRateClause: null,
  notes: null,
  fieldConfidence: { paymentAmount: 0.55 },
};

interface AppHarness {
  db: TestDb;
  app: Express;
}

function buildAppHarness(db: TestDb, llm: LlmProvider | undefined): AppHarness {
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
        ...(llm ? { llmProvider: llm } : {}),
      },
    },
  });
  return { db, app };
}

async function seedUser(
  db: TestDb,
  role: "admin" | "preparer" | "readonly",
): Promise<{ id: string }> {
  const r = await db
    .insert(users)
    .values({
      email: `${role}@firm.test`,
      name: role,
      role,
      status: "active",
      passwordHash: await hashPassword("Trombone-glacier-7!quiet-river2026"),
    })
    .returning();
  return { id: r[0]!.id };
}

async function cookie(db: TestDb, userId: string): Promise<string> {
  const s = await createSession(db, { userId });
  return `${SESSION_COOKIE_NAME}=${s.id}`;
}

describe("extractions — integration", () => {
  let harness: TestHarness;
  beforeAll(async () => {
    harness = await makeTestDb();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.truncateAll();
  });

  it("readonly user cannot create or run extractions", async () => {
    const ro = await seedUser(harness.db, "readonly");
    const c = await cookie(harness.db, ro.id);
    const app = buildAppHarness(harness.db, new StubProvider(VALID_OUT)).app;
    const r = await request(app)
      .post("/api/v1/extractions")
      .set("Cookie", c)
      .send({
        sourceFilename: "loan.pdf",
        documentText: "x".repeat(50),
      });
    expect(r.status).toBe(403);
  });

  it("preparer creates a job, runs it against the stub provider, sees needs_review status + flagged fields", async () => {
    const prep = await seedUser(harness.db, "preparer");
    const c = await cookie(harness.db, prep.id);
    const app = buildAppHarness(harness.db, new StubProvider(VALID_OUT)).app;

    const create = await request(app)
      .post("/api/v1/extractions")
      .set("Cookie", c)
      .send({
        sourceFilename: "loan.pdf",
        documentText: "30-year fixed-rate loan agreement…".repeat(5),
      });
    expect(create.status).toBe(201);
    const id = create.body.extraction.id as string;

    const run = await request(app).post(`/api/v1/extractions/${id}/run`).set("Cookie", c);
    expect(run.status).toBe(200);
    expect(run.body.extraction.status).toBe("needs_review");
    expect(run.body.flaggedFields).toContain("paymentAmount");
    expect(run.body.extraction.extractedJson.principal).toBe(250_000);
    expect(run.body.extraction.inputTokens).toBe(100);
  });

  it("approve transitions the extraction status and records reviewer", async () => {
    const admin = await seedUser(harness.db, "admin");
    const c = await cookie(harness.db, admin.id);
    const app = buildAppHarness(harness.db, new StubProvider(VALID_OUT)).app;
    const create = await request(app)
      .post("/api/v1/extractions")
      .set("Cookie", c)
      .send({
        sourceFilename: "loan.pdf",
        documentText: "x".repeat(60),
      });
    const id = create.body.extraction.id as string;
    await request(app).post(`/api/v1/extractions/${id}/run`).set("Cookie", c);

    const approve = await request(app).post(`/api/v1/extractions/${id}/approve`).set("Cookie", c);
    expect(approve.status).toBe(200);
    expect(approve.body.extraction.status).toBe("approved");
    expect(approve.body.extraction.reviewedBy).toBe(admin.id);
  });

  it("503 when no LLM provider is configured", async () => {
    const admin = await seedUser(harness.db, "admin");
    const c = await cookie(harness.db, admin.id);
    const app = buildAppHarness(harness.db, undefined).app;
    const create = await request(app)
      .post("/api/v1/extractions")
      .set("Cookie", c)
      .send({
        sourceFilename: "loan.pdf",
        documentText: "x".repeat(60),
      });
    const run = await request(app)
      .post(`/api/v1/extractions/${create.body.extraction.id}/run`)
      .set("Cookie", c);
    expect(run.status).toBe(503);
  });
});
