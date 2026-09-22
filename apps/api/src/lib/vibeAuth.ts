import express, { type Request, type RequestHandler, type Response } from "express";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { Pool } from "pg";
import { sessions, users, type Database } from "@vibe-calc/db";
import { roleHasPermission } from "@vibe-calc/shared-types";
import {
  createPgStores,
  createVibeAuth,
  sendHttpResponse,
  toHttpRequest,
  type HttpRequest,
  type HttpResponse,
  type Logger,
  type SessionAdapter,
  type VibeAuth,
} from "@kisaesdevlab/vibe-auth";
import { clearSessionCookie, setSessionCookie, SESSION_COOKIE_NAME } from "./cookies.js";
import type { Env } from "./env.js";
import type { KmsClient } from "./kms.js";
import { createSession, revokeSessionByToken } from "./sessions.js";
import { clientIp } from "../middleware/auth.js";
import { VIBE_CALC_ROLES, createVibeAuditSink, createVibeUsers } from "./vibeAuthUsers.js";

/**
 * Single sign-on via @kisaesdevlab/vibe-auth. The package owns the OIDC
 * flow (Authorization Code + PKCE), the Settings → Authentication API and
 * the break-glass rules; this module is the product side:
 *
 *   - SessionAdapter: an SSO sign-in mints the same `vibecalc_sid` cookie
 *     session a password login does, with the OIDC identity on the row.
 *   - Identity / settings stores on the package tables (pg pool), client
 *     secret wrapped with VIBE_KMS_KEY, audit into the auth_events chain.
 *
 * Three principals, one rule: API keys (`Bearer vibe_…`) and magic links
 * are untouched; only the cookie session is SSO-aware. The middleware
 * mounts AFTER loadSession, which never rejects and resolves bearer keys
 * first, so `/auth/*` cannot interfere with API-key calls.
 *
 * Paths: every ingress strips the SPA prefix before the API sees a
 * request (appliance Caddy mounts us at /calc/), so the engine routes on
 * `/auth/*` with an empty basePath. Anything the engine hands the BROWSER
 * (login page, return-to, the test-connection URL) needs the prefix back;
 * it comes from VIBE_OIDC_PUBLIC_URL, which the redirect URI is built
 * from as well.
 */

const AUTH_PREFIX = "/auth";

export interface CalcVibeAuthOptions {
  db: Database;
  pool: Pool;
  kms: KmsClient;
  deployMode: Env["VIBE_DEPLOY_MODE"];
  logger: Logger;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export interface CalcVibeAuth {
  auth: VibeAuth;
  /** Mount at app level after loadSession, before the routers. */
  middleware: RequestHandler;
  /** Browser-facing SPA prefix ('' or e.g. '/calc'). */
  spaPrefix: string;
}

/**
 * What the local-login routes need from the engine. Narrow on purpose so
 * route tests can run without one (every field optional at the call site).
 */
export type LocalLoginPolicy = Pick<VibeAuth, "localLoginAllowed" | "afterLocalLogin" | "config">;

function spaPrefixFrom(publicUrl: string | undefined): string {
  if (!publicUrl?.trim()) return "";
  try {
    return new URL(publicUrl.trim()).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function createCalcVibeAuth(opts: CalcVibeAuthOptions): CalcVibeAuth {
  const { db, kms, logger } = opts;
  const env = opts.env ?? process.env;
  const spaPrefix = spaPrefixFrom(env.VIBE_OIDC_PUBLIC_URL);
  const warn = (msg: string, meta?: Record<string, unknown>) => logger.warn(msg, meta);

  const stores = createPgStores({
    query: async (text, params = []) =>
      (await opts.pool.query(text, params as unknown[])).rows as Array<Record<string, unknown>>,
  });

  const session: SessionAdapter = {
    /** Same row + cookie as POST /api/v1/auth/login, plus the identity. */
    async create(req: Request, res: Response, user, identity) {
      const created = await createSession(db, {
        userId: user.id,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? undefined,
        oidc: {
          issuer: identity.issuer,
          subject: identity.subject,
          sid: identity.sid,
          idToken: identity.idToken ? kms.encrypt(identity.idToken) : undefined,
        },
      });
      // Mirrors magic-link consume: the first sign-in activates an invite.
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await db
        .update(users)
        .set({ status: "active" })
        .where(and(eq(users.id, user.id), eq(users.status, "pending")));
      setSessionCookie(res, created.token, { deployMode: opts.deployMode });
    },

    async destroy(req: Request, res: Response) {
      const token = req.cookies?.[SESSION_COOKIE_NAME] as unknown;
      if (typeof token === "string" && token) await revokeSessionByToken(db, token);
      clearSessionCookie(res, { deployMode: opts.deployMode });
    },

    // loadSession already ran. req.session is set for cookie sessions only,
    // so an API key never authorises the settings API or /auth/me.
    async currentUserId(req: Request) {
      return req.session && req.user ? req.user.id : null;
    },

    async currentIdentity(req: Request) {
      const s = req.session;
      if (!s?.oidcIssuer || !s.oidcSubject) return null;
      let idToken: string | undefined;
      if (s.oidcIdToken) {
        try {
          idToken = kms.decrypt(s.oidcIdToken);
        } catch {
          // Key rotated: logout still works, just without the hint.
        }
      }
      return {
        issuer: s.oidcIssuer,
        subject: s.oidcSubject,
        ...(s.oidcSid ? { sid: s.oidcSid } : {}),
        ...(idToken ? { idToken } : {}),
      };
    },

    /**
     * Back-channel logout. With a resolved user every session of theirs
     * ends (the IdP said this person is signed out); a sid-only token ends
     * just the sessions born from that IdP session.
     */
    async destroyByIdentity(i) {
      const conds: SQL[] = [];
      if (i.sid) conds.push(eq(sessions.oidcSid, i.sid));
      if (i.subject) {
        const c = and(eq(sessions.oidcIssuer, i.issuer), eq(sessions.oidcSubject, i.subject));
        if (c) conds.push(c);
      }
      if (i.userId) conds.push(eq(sessions.userId, i.userId));
      if (!conds.length) return 0;
      const ended = await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(isNull(sessions.revokedAt), conds.length === 1 ? conds[0] : or(...conds)))
        .returning({ id: sessions.id });
      return ended.length;
    },
  };

  /**
   * Settings → Authentication follows the permission matrix
   * (`settings:write`), not the package's role-equality default.
   */
  async function authorizeAdmin(req: HttpRequest): Promise<{ userId: string } | null> {
    const r = req.raw.req as Request;
    if (!r.session || !r.user) return null;
    if (!roleHasPermission(r.user.role, "settings:write")) return null;
    return { userId: r.user.id };
  }

  const auth = createVibeAuth({
    product: { slug: "vibe-calculators", name: "Vibe Calculators", roles: VIBE_CALC_ROLES },
    users: createVibeUsers(db, { warn }),
    session,
    identities: stores.identities,
    settings: stores.settings,
    revocations: stores.revocations,
    secretWrap: {
      wrap: async (plaintext) => kms.encrypt(plaintext),
      unwrap: async (wrapped) => kms.decrypt(wrapped),
    },
    audit: createVibeAuditSink(db, { warn }),
    env,
    basePath: "",
    loginPath: `${spaPrefix}/login`,
    breakglassLoginPath: `${spaPrefix}/login/local`,
    defaultReturnTo: `${spaPrefix}/`,
    trustProxy: true,
    syncRoles: true,
    authorizeAdmin,
    logger,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  const urlencoded = express.urlencoded({ extended: false });

  const middleware: RequestHandler = (req, res, next) => {
    if (req.path !== AUTH_PREFIX && !req.path.startsWith(`${AUTH_PREFIX}/`)) return next();
    // Back-channel logout posts a form; scoped here so no other route
    // starts accepting urlencoded bodies.
    urlencoded(req, res, (err?: unknown) => {
      if (err) return next(err);
      auth
        .handle(toHttpRequest(req, res))
        .then((r) => {
          if (!r) return next();
          sendHttpResponse(res, forBrowser(r, res, spaPrefix));
        })
        .catch(next);
    });
  };

  return { auth, middleware, spaPrefix };
}

function isJsonObject(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === "object" && !Buffer.isBuffer(body) && !Array.isArray(body);
}

function forBrowser(r: HttpResponse, res: Response, spaPrefix: string): HttpResponse {
  const withPrefix = (v: string) => (v.startsWith(AUTH_PREFIX) ? spaPrefix + v : v);

  // Engine-built paths in JSON answers are server-relative.
  if (spaPrefix && isJsonObject(r.body)) {
    if (typeof r.body.url === "string") r.body.url = withPrefix(r.body.url);
    const oidc = r.body.oidc;
    if (isJsonObject(oidc) && typeof oidc.startPath === "string") {
      oidc.startPath = withPrefix(oidc.startPath);
    }
  }

  // The engine's own pages (logged out, sign-in error, test-connection
  // result) carry an inline style and, for the popup, an inline
  // postMessage script. helmet()'s default CSP blocks both, so these pages
  // — and only these — get a CSP that permits exactly that, and the popup
  // keeps window.opener.
  const type = String(r.headers["content-type"] ?? "");
  if (type.includes("text/html")) {
    r.headers["content-security-policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
    res.removeHeader("Cross-Origin-Opener-Policy");
  }
  return r;
}
