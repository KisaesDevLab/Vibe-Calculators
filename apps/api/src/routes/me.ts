import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { recoveryCodes, sessions, users, type Database } from "@vibe-calc/db";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "../lib/password.js";
import {
  buildEnrollment,
  generateRecoveryCodes,
  hashRecoveryCode,
  renderQrPngDataUrl,
  verifyTotp,
} from "../lib/totp.js";
import {
  listActiveSessionsForUser,
  revokeAllUserSessions,
  revokeSession,
} from "../lib/sessions.js";
import { recordAuthEvent } from "../lib/auth-events.js";
import type { SecretSealer } from "../lib/totp.js";
import { clientIp, problem, requireAuth } from "../middleware/auth.js";
import { and } from "drizzle-orm";

export interface MeRouteDeps {
  db: Database;
  totpSealer: SecretSealer;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(12),
});

const totpEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const totpDisableSchema = z.object({ password: z.string().min(1) });

export function buildMeRouter(deps: MeRouteDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/password", async (req: Request, res: Response) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
    const user = req.user!;

    if (user.passwordHash) {
      if (!parsed.data.currentPassword) {
        return problem(res, 400, "Bad request", "currentPassword is required");
      }
      const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
      if (!ok) return problem(res, 401, "Unauthorized", "Current password is wrong");
    }
    const policy = validatePasswordPolicy(parsed.data.newPassword, {
      email: user.email,
      name: user.name,
    });
    if (!policy.ok) return problem(res, 422, "Password policy", policy.message);

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await deps.db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await recordAuthEvent(deps.db, {
      kind: user.passwordHash ? "password.changed" : "password.set",
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    res.status(204).send();
  });

  router.post("/2fa/setup", async (req: Request, res: Response) => {
    const user = req.user!;
    if (user.totpEnabled) {
      return problem(res, 409, "Conflict", "TOTP already enabled");
    }
    const enroll = buildEnrollment(user.email);
    const sealed = deps.totpSealer.seal(enroll.secretBase32);
    await deps.db.update(users).set({ totpSecret: sealed }).where(eq(users.id, user.id));
    const qrPng = await renderQrPngDataUrl(enroll.otpauthUrl);
    res.json({ otpauthUrl: enroll.otpauthUrl, qrPng });
  });

  router.post("/2fa/enable", async (req: Request, res: Response) => {
    const parsed = totpEnableSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid code");
    const user = req.user!;
    if (!user.totpSecret) {
      return problem(res, 409, "Conflict", "Run /me/2fa/setup first");
    }
    const secret = deps.totpSealer.unseal(user.totpSecret);
    if (!verifyTotp(secret, parsed.data.code)) {
      return problem(res, 401, "Unauthorized", "TOTP code is wrong");
    }
    const codes = generateRecoveryCodes();
    await deps.db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
    await deps.db
      .insert(recoveryCodes)
      .values(codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })));
    await recordAuthEvent(deps.db, {
      kind: "totp.enrolled",
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    res.json({ recoveryCodes: codes });
  });

  router.post("/2fa/disable", async (req: Request, res: Response) => {
    const parsed = totpDisableSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
    const user = req.user!;
    if (!user.totpEnabled) {
      return problem(res, 409, "Conflict", "TOTP not enabled");
    }
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
      return problem(res, 401, "Unauthorized", "Wrong password");
    }
    await deps.db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null })
      .where(eq(users.id, user.id));
    await deps.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await recordAuthEvent(deps.db, {
      kind: "totp.disabled",
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    res.status(204).send();
  });

  router.get("/sessions", async (req: Request, res: Response) => {
    const list = await listActiveSessionsForUser(deps.db, req.user!.id);
    res.json({
      sessions: list.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        ip: s.ip,
        userAgent: s.userAgent,
        current: s.id === req.session?.id,
      })),
    });
  });

  router.delete("/sessions/:id", async (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) return problem(res, 400, "Bad request", "Missing session id");

    // Verify the session belongs to this user.
    const [row] = await deps.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.user!.id)))
      .limit(1);
    if (!row) return problem(res, 404, "Not found", "Session not found");

    await revokeSession(deps.db, id);
    await recordAuthEvent(deps.db, {
      kind: "session.revoked",
      userId: req.user!.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
      payload: { sessionId: id },
    });
    res.status(204).send();
  });

  router.delete("/sessions", async (req: Request, res: Response) => {
    await revokeAllUserSessions(deps.db, req.user!.id);
    await recordAuthEvent(deps.db, {
      kind: "session.revoked",
      userId: req.user!.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
      payload: { all: true },
    });
    res.status(204).send();
  });

  return router;
}
