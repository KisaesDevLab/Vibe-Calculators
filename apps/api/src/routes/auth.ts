import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users, type Database } from "@vibe-calc/db";
import { recoveryCodes } from "@vibe-calc/db";
import { and } from "drizzle-orm";
import { verifyPassword } from "../lib/password.js";
import { verifyTotp, hashRecoveryCode } from "../lib/totp.js";
import { ROLLING_TTL_MS, createSession, resolveSession, revokeSession } from "../lib/sessions.js";
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from "../lib/cookies.js";
import { recordAuthEvent } from "../lib/auth-events.js";
import {
  requestMagicLink as issueMagicLink,
  consumeMagicLink as consumeMagicLinkRow,
} from "../lib/magic-link.js";
import type { RateLimiter } from "../lib/rate-limit.js";
import type { SecretSealer } from "../lib/totp.js";
import { permissionsFor, type Permission, type Role } from "@vibe-calc/shared-types";
import { clientIp, problem } from "../middleware/auth.js";
import type { Env } from "../lib/env.js";

export interface AuthRouteDeps {
  db: Database;
  env: Pick<Env, "VIBE_DEPLOY_MODE">;
  rateLimiter: RateLimiter;
  /** Mailer surface — Phase 22 wires real SMTP. For Phase 2 we log. */
  emitMagicLinkEmail: (input: {
    email: string;
    token: string;
    consumeUrl: string;
    expiresAt: Date;
  }) => Promise<void> | void;
  totpSealer: SecretSealer;
}

const loginBodySchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

const magicLinkRequestSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const magicLinkConsumeSchema = z.object({
  token: z.string().min(32),
  /** TOTP code (6 digits) — required when target user has TOTP enabled. */
  totpCode: z
    .string()
    .regex(/^\d{6}$/u)
    .optional(),
  /** One-shot recovery code — alternative to totpCode for 2FA users. */
  recoveryCode: z.string().min(8).max(64).optional(),
});

export function buildAuthRouter(deps: AuthRouteDeps): Router {
  const router = Router();

  router.post("/login", async (req: Request, res: Response) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid login body");
    }
    const { email, password, totpCode } = parsed.data;
    const ip = clientIp(req);

    // Rate limit lookup BEFORE password check so failed-against-locked
    // attempts return immediately without spending Argon2 cycles.
    const lock = await deps.rateLimiter.status(ip, email);
    if (lock.locked) {
      res.setHeader("Retry-After", Math.ceil(lock.retryAfterMs / 1000));
      return problem(
        res,
        429,
        "Too many requests",
        `Locked. Try again in ${Math.ceil(lock.retryAfterMs / 1000)}s.`,
      );
    }

    const [user] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.archivedAt !== null || !user.passwordHash || user.status === "suspended") {
      const failure = await deps.rateLimiter.recordFailure(ip, email);
      await recordAuthEvent(deps.db, {
        kind: "login.failed",
        ip,
        userAgent: req.headers["user-agent"] ?? undefined,
        payload: { email, reason: "user-not-eligible" },
      });
      return rejectLogin(res, failure);
    }

    const okPw = await verifyPassword(user.passwordHash, password);
    if (!okPw) {
      const failure = await deps.rateLimiter.recordFailure(ip, email);
      await recordAuthEvent(deps.db, {
        kind: "login.failed",
        userId: user.id,
        ip,
        userAgent: req.headers["user-agent"] ?? undefined,
        payload: { email, reason: "bad-password" },
      });
      return rejectLogin(res, failure);
    }

    if (user.totpEnabled) {
      if (!totpCode) {
        return problem(res, 401, "TOTP required", "totp_code field is required");
      }
      if (!user.totpSecret) {
        return problem(res, 500, "Server error", "TOTP enabled but no secret stored");
      }
      const secret = deps.totpSealer.unseal(user.totpSecret);
      if (!verifyTotp(secret, totpCode)) {
        const failure = await deps.rateLimiter.recordFailure(ip, email);
        await recordAuthEvent(deps.db, {
          kind: "login.failed",
          userId: user.id,
          ip,
          userAgent: req.headers["user-agent"] ?? undefined,
          payload: { email, reason: "bad-totp" },
        });
        return rejectLogin(res, failure);
      }
    }

    const session = await createSession(deps.db, {
      userId: user.id,
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
    });

    await deps.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    await deps.rateLimiter.clearOnSuccess(ip, email);
    await recordAuthEvent(deps.db, {
      kind: "login.success",
      userId: user.id,
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
      payload: { sessionId: session.id },
    });

    setSessionCookie(res, session.id, { deployMode: deps.env.VIBE_DEPLOY_MODE });
    res.status(200).json({
      user: publicUser(user, permissionsFor(user.role)),
      session: { expiresAt: session.expiresAt.toISOString() },
    });
  });

  router.post("/logout", async (req: Request, res: Response) => {
    const sid = (req.cookies?.[SESSION_COOKIE_NAME] as string | undefined) ?? "";
    if (sid) {
      const resolved = await resolveSession(deps.db, sid);
      if (resolved) {
        await revokeSession(deps.db, sid);
        await recordAuthEvent(deps.db, {
          kind: "logout",
          userId: resolved.user.id,
          ip: clientIp(req),
          userAgent: req.headers["user-agent"] ?? undefined,
        });
      }
    }
    clearSessionCookie(res, { deployMode: deps.env.VIBE_DEPLOY_MODE });
    res.status(204).send();
  });

  router.post("/magic-link", async (req: Request, res: Response) => {
    const parsed = magicLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid magic-link body");
    }
    const ip = clientIp(req);
    // Rate-limit per (ip, email) to prevent mailbox-spam abuse. Same
    // attempt-limit + escalation ladder as login.
    const status = await deps.rateLimiter.status(ip, parsed.data.email);
    if (status.locked) {
      return problem(
        res,
        429,
        "Too many requests",
        `Rate limit hit for magic-link issuance. Retry after ${Math.ceil(status.retryAfterMs / 1000)}s.`,
      );
    }
    const [user] = await deps.db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    // Always 202 to avoid disclosing email enumeration.
    if (!user || user.archivedAt !== null || user.status === "suspended") {
      // Charge the rate-limit even on miss, so an attacker can't
      // probe email enumeration for free.
      await deps.rateLimiter.recordFailure(ip, parsed.data.email);
      return res.status(202).json({ accepted: true });
    }

    const issued = await issueMagicLink(deps.db, { userId: user.id, ip });
    const consumeUrl = `/login/magic?token=${issued.token}`;
    await deps.emitMagicLinkEmail({
      email: parsed.data.email,
      token: issued.token,
      consumeUrl,
      expiresAt: issued.expiresAt,
    });
    await recordAuthEvent(deps.db, {
      kind: "magic_link.requested",
      userId: user.id,
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
      payload: { email: parsed.data.email },
    });
    res.status(202).json({ accepted: true });
  });

  router.post("/magic-link/consume", async (req: Request, res: Response) => {
    const parsed = magicLinkConsumeSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid token body");
    }
    const ip = clientIp(req);
    const result = await consumeMagicLinkRow(deps.db, { token: parsed.data.token, ip });
    if (!result.ok) {
      await recordAuthEvent(deps.db, {
        kind: "magic_link.consumed.failed",
        ip,
        userAgent: req.headers["user-agent"] ?? undefined,
        payload: { reason: result.reason },
      });
      return problem(res, 401, "Invalid token", `Magic link is ${result.reason}`);
    }

    // 2FA gate: if the target user has TOTP enabled, the magic-link
    // consume MUST be paired with either a current TOTP code OR a
    // one-shot recovery code. A magic link alone is single-factor and
    // cannot bypass 2FA.
    if (result.user.totpEnabled) {
      const totpCode = parsed.data.totpCode;
      const recoveryCode = parsed.data.recoveryCode;
      let secondFactorOk = false;
      if (totpCode && result.user.totpSecret) {
        const secret = deps.totpSealer.unseal(result.user.totpSecret);
        secondFactorOk = verifyTotp(secret, totpCode);
      } else if (recoveryCode) {
        const codeHash = hashRecoveryCode(recoveryCode);
        // One-shot consume: delete-by-(userId, codeHash) and accept
        // only if exactly one row matched.
        const deleted = await deps.db
          .delete(recoveryCodes)
          .where(
            and(eq(recoveryCodes.userId, result.user.id), eq(recoveryCodes.codeHash, codeHash)),
          )
          .returning({ id: recoveryCodes.id });
        secondFactorOk = deleted.length === 1;
        if (secondFactorOk) {
          await recordAuthEvent(deps.db, {
            kind: "totp.recovery_used",
            userId: result.user.id,
            ip,
            userAgent: req.headers["user-agent"] ?? undefined,
          });
        }
      }
      if (!secondFactorOk) {
        await recordAuthEvent(deps.db, {
          kind: "magic_link.consumed.failed",
          userId: result.user.id,
          ip,
          userAgent: req.headers["user-agent"] ?? undefined,
          payload: { reason: "2fa_required" },
        });
        return problem(
          res,
          401,
          "TOTP required",
          "This account has 2FA enabled. Provide totpCode or recoveryCode.",
        );
      }
    }

    // First successful magic-link login activates a pending user.
    if (result.user.status === "pending") {
      await deps.db
        .update(users)
        .set({ status: "active", lastLoginAt: new Date() })
        .where(eq(users.id, result.user.id));
      result.user.status = "active";
    }

    const session = await createSession(deps.db, {
      userId: result.user.id,
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    await recordAuthEvent(deps.db, {
      kind: "magic_link.consumed",
      userId: result.user.id,
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
      payload: { sessionId: session.id },
    });
    setSessionCookie(res, session.id, { deployMode: deps.env.VIBE_DEPLOY_MODE });
    res.status(200).json({
      user: publicUser(result.user, permissionsFor(result.user.role)),
      session: { expiresAt: session.expiresAt.toISOString() },
    });
  });

  router.get("/me", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    res.json({
      user: publicUser(req.user, permissionsFor(req.user.role)),
      session: req.session
        ? {
            expiresAt: req.session.expiresAt.toISOString(),
            absoluteExpiresAt: req.session.absoluteExpiresAt.toISOString(),
          }
        : null,
    });
  });

  return router;
}

function rejectLogin(res: Response, failure: { locked: boolean; retryAfterMs?: number }): void {
  if (failure.locked && failure.retryAfterMs) {
    res.setHeader("Retry-After", Math.ceil(failure.retryAfterMs / 1000));
    problem(
      res,
      429,
      "Too many requests",
      `Locked. Try again in ${Math.ceil(failure.retryAfterMs / 1000)}s.`,
    );
    return;
  }
  problem(res, 401, "Unauthorized", "Invalid credentials");
}

interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "pending" | "active" | "suspended";
  totpEnabled: boolean;
  permissions: readonly Permission[];
}

function publicUser(
  row: {
    id: string;
    email: string;
    name: string;
    role: Role;
    status: string;
    totpEnabled: boolean;
  },
  permissions: readonly Permission[],
): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status as PublicUser["status"],
    totpEnabled: row.totpEnabled,
    permissions,
  };
}

export const ROLLING_TTL_MS_EXPORT = ROLLING_TTL_MS;
