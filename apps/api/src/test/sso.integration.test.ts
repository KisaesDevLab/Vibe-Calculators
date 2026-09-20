import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys, authEvents, sessions, users } from "@vibe-calc/db";
import { breakglassEnsure, makeAudit, type VibeAuth } from "@kisaesdevlab/vibe-auth";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";
import { FakeIdp, type FakeIdpUser } from "./fake-idp.js";
import { createApp } from "../server.js";
import { generateToken } from "../lib/api-keys.js";
import { validateAuthEventChain } from "../lib/auth-events.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";
import { createKms } from "../lib/kms.js";
import { hashPassword } from "../lib/password.js";
import { createRateLimiter, memoryStore } from "../lib/rate-limit.js";
import { sealerFrom } from "../lib/totp.js";
import { createCalcVibeAuth } from "../lib/vibeAuth.js";
import {
  BREAKGLASS_EMAIL,
  VIBE_CALC_ROLES,
  createVibeAuditSink,
  createVibeUsers,
} from "../lib/vibeAuthUsers.js";

/**
 * Single sign-on — end to end against the package's fake IdP and a real
 * Postgres: the real engine, the real adapters, the real Express app.
 *
 * The public URL carries the appliance prefix (/calc). Caddy strips it
 * before the API sees a request, so the test strips it from the redirect
 * URI the IdP sends the browser back to, exactly as the ingress would.
 */

const CLIENT_ID = "vibe-calculators";
const CLIENT_SECRET = "s3cret";
const PUBLIC_URL = "http://calc.test/calc";
const PREFIX = "/calc";

interface SsoApp {
  app: Express;
  auth: VibeAuth;
  magicLinks: { email: string; token: string }[];
}

let harness: TestHarness;
let db: TestDb;
let idp: FakeIdp;
const kms = createKms(randomBytes(32).toString("base64"));
const started: VibeAuth[] = [];

async function buildApp(mode: "local" | "both" | "oidc_only"): Promise<SsoApp> {
  const env = { VIBE_DEPLOY_MODE: "lan" as const };
  const magicLinks: { email: string; token: string }[] = [];
  const sso = createCalcVibeAuth({
    db,
    pool: harness.pool,
    kms,
    deployMode: "lan",
    logger: { info() {}, warn() {}, error() {} },
    env: {
      VIBE_AUTH_MODE: mode,
      VIBE_OIDC_ISSUER: idp.issuer,
      VIBE_OIDC_CLIENT_ID: CLIENT_ID,
      VIBE_OIDC_CLIENT_SECRET: CLIENT_SECRET,
      VIBE_OIDC_PUBLIC_URL: PUBLIC_URL,
    },
  });
  await sso.auth.start();
  started.push(sso.auth);
  const app = createApp({
    auth: {
      middleware: { db, env },
      sso: sso.middleware,
      routes: {
        db,
        env,
        rateLimiter: createRateLimiter(memoryStore()),
        totpSealer: sealerFrom(kms),
        kms,
        vibeAuth: sso.auth,
        emitMagicLinkEmail: (input) => {
          magicLinks.push({ email: input.email, token: input.token });
        },
      },
    },
  });
  return { app, auth: sso.auth, magicLinks };
}

/** Browser walk: start → IdP authorize → callback (prefix stripped by "Caddy"). */
async function ssoSignIn(app: Express, cookie?: string) {
  const start = request(app).get(`/auth/oidc/start?return_to=${encodeURIComponent(`${PREFIX}/`)}`);
  if (cookie) void start.set("Cookie", cookie);
  const started = await start;
  expect(started.status).toBe(302);
  const authorize = await fetch(started.headers.location as string, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const back = new URL(authorize.headers.get("location") as string);
  expect(`${back.origin}${back.pathname}`).toBe(`${PUBLIC_URL}/auth/oidc/callback`);
  return request(app).get(back.pathname.slice(PREFIX.length) + back.search);
}

function sessionCookie(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const hit = raw.map((c) => c.split(";")[0] ?? "").find((c) => c.startsWith(SESSION_COOKIE_NAME));
  if (!hit) throw new Error("no session cookie set");
  return hit;
}

async function seedUser(fields: {
  email: string;
  role: "admin" | "reviewer" | "preparer" | "readonly";
  status?: "pending" | "active";
  password?: string;
}) {
  const [row] = await db
    .insert(users)
    .values({
      email: fields.email,
      name: fields.email,
      role: fields.role,
      status: fields.status ?? "active",
      passwordHash: fields.password ? await hashPassword(fields.password) : null,
    })
    .returning();
  return row!;
}

async function ensureBreakglass(): Promise<string> {
  const result = await breakglassEnsure({
    users: createVibeUsers(db),
    audit: makeAudit(createVibeAuditSink(db)),
    username: "vibe-breakglass",
    adminRole: VIBE_CALC_ROLES.adminRole,
    email: BREAKGLASS_EMAIL,
  });
  return result.password as string;
}

const ALICE: FakeIdpUser = {
  sub: "sub-alice",
  email: "alice@firm.test",
  email_verified: true,
  name: "Alice Manager",
  groups: ["vibe-manager"],
};

describe("single sign-on — integration", () => {
  beforeAll(async () => {
    harness = await makeTestDb();
    db = harness.db;
    idp = await new FakeIdp({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      user: ALICE,
    }).start();
  }, 120_000);

  afterAll(async () => {
    for (const a of started) a.stop();
    await idp.stop();
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncateAll();
    idp.user = { ...ALICE };
  });

  it("local mode: SSO is off and local login is unchanged", async () => {
    const { app } = await buildApp("local");
    await seedUser({ email: "pat@firm.test", role: "preparer", password: "correct horse battery" });

    const status = await request(app).get("/auth/status");
    expect(status.status).toBe(200);
    expect(status.body.mode).toBe("local");
    expect(status.body.oidc.enabled).toBe(false);

    expect((await request(app).get("/auth/oidc/start")).status).toBe(409);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "pat@firm.test", password: "correct horse battery" });
    expect(login.status).toBe(200);
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", sessionCookie(login));
    expect(me.body.session.sso).toBe(false);
  });

  it("both: PKCE sign-in JIT-provisions with the mapped role and a normal cookie session", async () => {
    const { app } = await buildApp("both");

    const status = await request(app).get("/auth/status");
    expect(status.body.oidc.enabled).toBe(true);
    expect(status.body.oidc.startPath).toBe(`${PREFIX}/auth/oidc/start`);

    const cb = await ssoSignIn(app);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`${PREFIX}/`);

    const [row] = await db.select().from(users).where(eq(users.email, "alice@firm.test"));
    expect(row).toMatchObject({
      role: "reviewer",
      status: "active",
      passwordHash: null,
      mustChangePassword: false,
      name: "Alice Manager",
    });

    const me = await request(app).get("/api/v1/auth/me").set("Cookie", sessionCookie(cb));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("alice@firm.test");
    expect(me.body.user.mustChangePassword).toBe(false);
    expect(me.body.session.sso).toBe(true);

    // The ID token is sealed at rest.
    const [s] = await db.select().from(sessions).where(eq(sessions.userId, row!.id));
    expect(s!.oidcSubject).toBe("sub-alice");
    expect(s!.oidcSid).toBe("sid-sub-alice");
    expect(s!.oidcIdToken).toMatch(/^v1:/);
  });

  it("links an existing user by verified email, syncs the role, activates an invite", async () => {
    const { app } = await buildApp("both");
    await seedUser({ email: "boss@firm.test", role: "admin" });
    const existing = await seedUser({
      email: "alice@firm.test",
      role: "readonly",
      status: "pending",
    });

    expect((await ssoSignIn(app)).status).toBe(302);
    const [row] = await db.select().from(users).where(eq(users.id, existing.id));
    expect(row).toMatchObject({ role: "reviewer", status: "active" });
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("role sync never demotes the last active admin", async () => {
    const { app } = await buildApp("both");
    const onlyAdmin = await seedUser({ email: "alice@firm.test", role: "admin" });
    await ensureBreakglass(); // an admin row, but it must not count

    expect((await ssoSignIn(app)).status).toBe(302);
    const [row] = await db.select().from(users).where(eq(users.id, onlyAdmin.id));
    expect(row!.role).toBe("admin");
  });

  it("refuses an unverified email and a suspended user, on a page helmet does not break", async () => {
    const { app } = await buildApp("both");
    idp.user = { ...ALICE, email_verified: false };
    const denied = await ssoSignIn(app);
    expect(denied.status).toBe(401);
    expect(denied.headers["content-security-policy"]).toContain("style-src 'unsafe-inline'");
    expect(denied.headers["cross-origin-opener-policy"]).toBeUndefined();
    expect(await db.select().from(users)).toHaveLength(0);

    idp.user = { ...ALICE };
    const [row] = await db
      .insert(users)
      .values({ email: "alice@firm.test", name: "A", role: "preparer", status: "suspended" })
      .returning();
    expect((await ssoSignIn(app)).status).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.userId, row!.id))).toHaveLength(0);
  });

  it("settings API follows settings:write and hands the browser a prefixed test URL", async () => {
    const { app } = await buildApp("both");
    const asAlice = sessionCookie(await ssoSignIn(app)); // reviewer
    expect((await request(app).get("/auth/settings").set("Cookie", asAlice)).status).toBe(403);
    expect((await request(app).get("/auth/settings")).status).toBe(403);

    await seedUser({ email: "boss@firm.test", role: "admin", password: "correct horse battery" });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "boss@firm.test", password: "correct horse battery" });
    const asBoss = sessionCookie(login);
    const settings = await request(app).get("/auth/settings").set("Cookie", asBoss);
    expect(settings.status).toBe(200);
    expect(settings.body.effective.redirectUri).toBe(`${PUBLIC_URL}/auth/oidc/callback`);
    expect(settings.body.effective.roleMap["vibe-partner"]).toBe("admin");

    const test = await request(app).post("/auth/settings/test").set("Cookie", asBoss).send({});
    expect(test.body.url).toBe(`${PREFIX}/auth/oidc/start?test=1`);

    // A client secret saved through settings is wrapped with the KMS key.
    const put = await request(app)
      .put("/auth/settings")
      .set("Cookie", asBoss)
      .send({ clientSecret: "rotated-secret" });
    expect(put.status).toBe(200);
    const stored = await harness.pool.query("SELECT value FROM auth_settings");
    expect(JSON.stringify(stored.rows)).not.toContain("rotated-secret");
  });

  it("an API key never opens the settings API and is untouched by the mode", async () => {
    const boss = await seedUser({ email: "boss@firm.test", role: "admin" });
    await ensureBreakglass();
    const { app } = await buildApp("oidc_only");
    const token = generateToken();
    await db.insert(apiKeys).values({
      name: "ci",
      prefix: token.prefix,
      tokenHash: token.hash,
      issuedBy: boss.id,
      actAsUserId: boss.id,
    });
    const bearer = { Authorization: `Bearer ${token.plaintext}` };

    const me = await request(app).get("/api/v1/auth/me").set(bearer);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("boss@firm.test");
    expect((await request(app).get("/auth/settings").set(bearer)).status).toBe(403);
    expect((await request(app).get("/auth/me").set(bearer)).status).toBe(401);
  });

  it("oidc_only refuses to start without an active break-glass user", async () => {
    await expect(buildApp("oidc_only")).rejects.toThrow(/break-glass/);
  });

  it("oidc_only: only break-glass signs in locally; magic links are closed", async () => {
    await seedUser({ email: "pat@firm.test", role: "preparer", password: "correct horse battery" });
    const password = await ensureBreakglass();
    const { app, magicLinks } = await buildApp("oidc_only");

    const [bg] = await db.select().from(users).where(eq(users.email, BREAKGLASS_EMAIL));
    expect(bg).toMatchObject({ role: "admin", status: "active", mustChangePassword: false });

    const refused = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "pat@firm.test", password: "correct horse battery" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("local_login_disabled");

    const link = await request(app)
      .post("/api/v1/auth/magic-link")
      .send({ email: "pat@firm.test" });
    expect(link.status).toBe(403);
    expect(magicLinks).toHaveLength(0);
    const consume = await request(app)
      .post("/api/v1/auth/magic-link/consume")
      .send({ token: "x".repeat(64) });
    expect(consume.status).toBe(403);

    // By the username the Appliance prints, in any case; and by the address.
    for (const email of ["Vibe-Breakglass", BREAKGLASS_EMAIL]) {
      const ok = await request(app).post("/api/v1/auth/login").send({ email, password });
      expect(ok.status).toBe(200);
      expect(ok.body.user.mustChangePassword).toBe(false);
    }
    const used = await db
      .select()
      .from(authEvents)
      .where(eq(authEvents.kind, "vibe.auth.breakglass.used"));
    expect(used).toHaveLength(2);
    expect(used[0]!.userId).toBe(bg!.id);

    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "vibe-breakglass", password: "nope" })
      ).status,
    ).toBe(401);
  });

  it("both: magic links keep working", async () => {
    const { app, magicLinks } = await buildApp("both");
    await seedUser({ email: "pat@firm.test", role: "preparer" });
    expect(
      (await request(app).post("/api/v1/auth/magic-link").send({ email: "pat@firm.test" })).status,
    ).toBe(202);
    const consume = await request(app)
      .post("/api/v1/auth/magic-link/consume")
      .send({ token: magicLinks[0]!.token });
    expect(consume.status).toBe(200);
  });

  it("back-channel logout ends the user's sessions; a fresh sign-in works", async () => {
    const { app } = await buildApp("both");
    const cookie = sessionCookie(await ssoSignIn(app));
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(200);

    const logout = await request(app)
      .post("/auth/oidc/backchannel")
      .type("form")
      .send({ logout_token: await idp.logoutToken({ sub: "sub-alice", sid: "sid-sub-alice" }) });
    expect(logout.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);

    const again = sessionCookie(await ssoSignIn(app));
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", again)).status).toBe(200);

    // urlencoded bodies are accepted under /auth/* only.
    const form = await request(app)
      .post("/api/v1/auth/login")
      .type("form")
      .send({ email: "alice@firm.test", password: "x" });
    expect(form.status).toBe(400);
  });

  it("RP-initiated logout revokes the session and carries the id_token_hint", async () => {
    const { app } = await buildApp("both");
    const cookie = sessionCookie(await ssoSignIn(app));

    const out = await request(app).get("/auth/oidc/logout").set("Cookie", cookie);
    expect(out.status).toBe(302);
    const target = new URL(out.headers.location as string);
    expect(target.pathname).toMatch(/\/end-session\/$/);
    expect(target.searchParams.get("id_token_hint")).toMatch(/^ey/);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(
      `${PUBLIC_URL}/auth/oidc/logged-out`,
    );
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);

    // ?local=1 ends only the app session and lands on the prefixed login page.
    const cookie2 = sessionCookie(await ssoSignIn(app));
    const local = await request(app).get("/auth/oidc/logout?local=1").set("Cookie", cookie2);
    expect(local.headers.location).toBe(`${PREFIX}/login`);
  });

  it("IdP down: local login keeps working and /auth/oidc/start answers 503", async () => {
    await seedUser({ email: "pat@firm.test", role: "preparer", password: "correct horse battery" });
    const env = { VIBE_DEPLOY_MODE: "lan" as const };
    const sso = createCalcVibeAuth({
      db,
      pool: harness.pool,
      kms,
      deployMode: "lan",
      logger: { info() {}, warn() {}, error() {} },
      env: {
        VIBE_AUTH_MODE: "both",
        VIBE_OIDC_ISSUER: "http://127.0.0.1:9/application/o/down/",
        VIBE_OIDC_CLIENT_ID: CLIENT_ID,
        VIBE_OIDC_PUBLIC_URL: PUBLIC_URL,
      },
    });
    await sso.auth.start();
    started.push(sso.auth);
    const app = createApp({
      auth: {
        middleware: { db, env },
        sso: sso.middleware,
        routes: {
          db,
          env,
          rateLimiter: createRateLimiter(memoryStore()),
          totpSealer: sealerFrom(kms),
          kms,
          vibeAuth: sso.auth,
          emitMagicLinkEmail: () => undefined,
        },
      },
    });
    expect((await request(app).get("/auth/oidc/start")).status).toBe(503);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "pat@firm.test", password: "correct horse battery" });
    expect(login.status).toBe(200);
  });

  it("SSO events join the tamper-evident auth_events chain", async () => {
    const { app } = await buildApp("both");
    await ssoSignIn(app);
    const kinds = (await db.select().from(authEvents)).map((e) => e.kind);
    expect(kinds).toContain("vibe.auth.user.provisioned");
    expect(kinds).toContain("vibe.auth.login.success");
    expect(await validateAuthEventChain(db)).toMatchObject({ ok: true });
  });
});
