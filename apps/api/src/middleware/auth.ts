import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  PermissionSchema,
  RoleSchema,
  permissionsFor,
  roleAtLeast,
  roleHasPermission,
  type Permission,
  type Role,
} from "@vibe-calc/shared-types";
import type { Database } from "@vibe-calc/db";
import { eq } from "drizzle-orm";
import { users } from "@vibe-calc/db";
import { SESSION_COOKIE_NAME, extendSession, resolveSession } from "../lib/sessions.js";
import { refreshSessionCookie } from "../lib/cookies.js";
import { verifyApiKeyHeader } from "../lib/api-keys.js";
import { checkApiKeyRateLimit } from "../lib/api-key-rate-limit.js";
import type { KeyValueStore } from "../lib/rate-limit.js";
import type { Env } from "../lib/env.js";

/**
 * Phase 2.12 — Express middleware for authentication and
 * authorization.
 *
 * Per CLAUDE.md "permissions go through middleware" rule. Every
 * mutating route uses requireAuth + (requireRole | requirePermission)
 * — no inline `if (req.user.role === "admin")` checks anywhere.
 */

// req.user / req.session are augmented onto Express's Request in
// apps/api/src/types/express.d.ts, which is auto-included by tsc.
//
// (The augmentation is in a top-level .d.ts rather than inline here
// because TS's per-file module-augmentation resolution under NodeNext
// resolves "express-serve-static-core" differently depending on the
// importing file's resolution path; a global .d.ts is the consistent
// way to attach the fields.)

export interface AuthMiddlewareOptions {
  db: Database;
  env: Pick<Env, "VIBE_DEPLOY_MODE">;
  /**
   * Phase 24.6 — Redis-backed key/value store for the per-API-key
   * rate limiter. Optional: when omitted, API-key rate limiting is
   * disabled (used by integration tests that don't spin up Redis
   * for the sole purpose of rate-limiting key auth).
   */
  apiKeyRateStore?: KeyValueStore | undefined;
}

/**
 * Loads the session cookie if present and attaches req.user / req.session.
 * Does NOT reject unauthenticated requests — pair with requireAuth()
 * for routes that need a user.
 */
export function loadSession(opts: AuthMiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      // Try Authorization: Bearer vibe_… first (Phase 24.2 API keys).
      // If a Bearer header is present, the request authenticates ONLY
      // through the API key — falling back to a cookie session would
      // silently authenticate as the wrong principal when the API
      // key is invalid or its act-as user has been suspended.
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const verified = await verifyApiKeyHeader(opts.db, authHeader);
        if (!verified || verified.expired || verified.revoked) {
          return next();
        }
        if (!verified.row.actAsUserId) {
          // Scope-only keys not yet supported (no scoped permission
          // resolver on req.user). Reject for now.
          return next();
        }
        // Phase 24.6 — per-key rate limit. Fixed 60-second window.
        // Default 60 req/min; row.rateLimitPerMin overrides.
        if (opts.apiKeyRateStore) {
          const rl = await checkApiKeyRateLimit(opts.apiKeyRateStore, {
            apiKeyId: verified.row.id,
            limitPerMin: verified.row.rateLimitPerMin,
          });
          res.setHeader("X-RateLimit-Limit", String(rl.limitPerMin));
          res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
          if (!rl.ok) {
            res.setHeader("Retry-After", String(rl.retryAfterSec));
            res.status(429).json({
              type: "about:blank#rate-limited",
              title: "Too many requests",
              status: 429,
              detail: `API key rate limit exceeded (${rl.limitPerMin} req/min). Retry after ${rl.retryAfterSec}s.`,
            });
            return;
          }
        }
        const [actAs] = await opts.db
          .select()
          .from(users)
          .where(eq(users.id, verified.row.actAsUserId))
          .limit(1);
        if (actAs && !actAs.archivedAt && actAs.status === "active") {
          req.user = actAs;
          req.apiKey = verified.row;
        }
        // Whether we authenticated successfully or not, do NOT fall
        // through to cookie auth — the explicit Bearer header signals
        // the caller wants API-key auth.
        return next();
      }

      const sid = req.cookies?.[SESSION_COOKIE_NAME] as unknown;
      if (typeof sid !== "string" || sid.length === 0) return next();
      const resolved = await resolveSession(opts.db, sid);
      if (!resolved) return next();
      req.user = resolved.user;
      req.session = resolved.session;
      const extended = await extendSession(opts.db, resolved.session);
      req.session = extended;
      // Re-issue the cookie with the SAME plaintext token (sid) — the
      // row has been bumped, but the cookie value never changes during
      // the session lifetime. Setting `extended.id` here would emit
      // the hashed value to the browser and break the next request.
      refreshSessionCookie(res, sid, { deployMode: opts.env.VIBE_DEPLOY_MODE });
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Reject if no authenticated user is attached. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user || !req.session) {
    return sendAuthError(res, 401, "Authentication required");
  }
  next();
};

/** Reject if the authenticated user's role is below `threshold`. */
export function requireRole(threshold: Role): RequestHandler {
  // Validate at build time that the threshold is a real role.
  RoleSchema.parse(threshold);
  return (req, res, next) => {
    if (!req.user) return sendAuthError(res, 401, "Authentication required");
    if (!roleAtLeast(req.user.role, threshold)) {
      return sendAuthError(
        res,
        403,
        `Role '${threshold}' or higher required (you are '${req.user.role}')`,
      );
    }
    next();
  };
}

/** Reject if the authenticated user's role does not grant `perm`. */
export function requirePermission(perm: Permission): RequestHandler {
  PermissionSchema.parse(perm);
  return (req, res, next) => {
    if (!req.user) return sendAuthError(res, 401, "Authentication required");
    if (!roleHasPermission(req.user.role, perm)) {
      return sendAuthError(res, 403, `Permission '${perm}' required`);
    }
    next();
  };
}

/** Helper for routes that want to introspect the caller's permissions. */
export function listPermissions(req: Request): readonly Permission[] {
  if (!req.user) return [];
  return permissionsFor(req.user.role);
}

function sendAuthError(res: Response, status: number, detail: string): void {
  res.status(status).json({
    type: status === 401 ? "about:blank#unauthorized" : "about:blank#forbidden",
    title: status === 401 ? "Unauthorized" : "Forbidden",
    status,
    detail,
  });
}

/** Tiny helper used by route handlers to emit RFC 7807 problem details. */
export function problem(
  res: Response,
  status: number,
  title: string,
  detail: string,
  extra: Record<string, unknown> = {},
): void {
  res.status(status).json({
    type: `about:blank#${title.toLowerCase().replace(/\s+/g, "-")}`,
    title,
    status,
    detail,
    ...extra,
  });
}

/**
 * Returns the requesting client's IP.
 *
 * **Important**: do NOT read X-Forwarded-For yourself. Caddy appends
 * to that header; the leftmost value is attacker-controlled. Express's
 * `req.ip` honours `trust proxy = 1` (set in server.ts) and returns
 * the rightmost trusted hop (the actual client). Reading the raw
 * header was a CVE-class bug — see security audit pass-2.
 */
export function clientIp(req: Request): string {
  return req.ip ?? "0.0.0.0";
}

/** Coerce next() error-passers to a typed signature for chained handlers. */
export type ChainHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
