import { Router, type Request, type Response } from "express";
import { and, desc, eq, ne, isNull } from "drizzle-orm";
import { z } from "zod";
import { recoveryCodes, users, type Database } from "@vibe-calc/db";
import { recordAuthEvent } from "../lib/auth-events.js";
import { requestMagicLink as issueMagicLink } from "../lib/magic-link.js";
import { revokeAllUserSessions } from "../lib/sessions.js";
import { RoleSchema } from "@vibe-calc/shared-types";
import { clientIp, problem, requirePermission } from "../middleware/auth.js";
import type { RateLimiter } from "../lib/rate-limit.js";

export interface AdminUserRouteDeps {
  db: Database;
  rateLimiter: RateLimiter;
  emitMagicLinkEmail: (input: {
    email: string;
    token: string;
    consumeUrl: string;
    expiresAt: Date;
  }) => Promise<void> | void;
}

const inviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(1),
  role: RoleSchema,
});

const roleChangeSchema = z.object({ role: RoleSchema });

/**
 * Last-active-admin guard. Returns { blocked: true, reason } when the
 * pending mutation (suspend/demote) would leave zero active admins.
 * Last-admin-out is operationally catastrophic — no further user
 * admin can occur until a DBA edits the rows directly.
 */
async function wouldRemoveLastActiveAdmin(
  db: Database,
  targetId: string,
  action: "suspend" | "demote",
): Promise<{ blocked: false } | { blocked: true; reason: string }> {
  const remainingAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.status, "active"),
        isNull(users.archivedAt),
        ne(users.id, targetId),
      ),
    );
  if (remainingAdmins.length === 0) {
    return {
      blocked: true,
      reason:
        action === "suspend"
          ? "Cannot suspend the last active admin — promote another user first."
          : "Cannot demote the last active admin — promote another user first.",
    };
  }
  return { blocked: false };
}

const clearLockoutSchema = z.object({
  email: z.string().email().toLowerCase(),
  ip: z.string().min(1),
});

export function buildAdminUsersRouter(deps: AdminUserRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), async (_req: Request, res: Response) => {
    const list = await deps.db.select().from(users).orderBy(desc(users.createdAt)).limit(500);
    res.json({
      users: list.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        totpEnabled: u.totpEnabled,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        archivedAt: u.archivedAt?.toISOString() ?? null,
      })),
    });
  });

  router.post("/invite", requirePermission("user:invite"), async (req: Request, res: Response) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid invite body");
    const ip = clientIp(req);

    // Refuse duplicate-email.
    const [existing] = await deps.db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    if (existing) return problem(res, 409, "Conflict", "User already exists");

    const [created] = await deps.db
      .insert(users)
      .values({
        email: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        status: "pending",
      })
      .returning();
    if (!created) return problem(res, 500, "Server error", "User insert failed");

    const issued = await issueMagicLink(deps.db, { userId: created.id, ip });
    const consumeUrl = `/login/magic?token=${issued.token}`;
    await deps.emitMagicLinkEmail({
      email: parsed.data.email,
      token: issued.token,
      consumeUrl,
      expiresAt: issued.expiresAt,
    });
    await recordAuthEvent(deps.db, {
      kind: "user.invited",
      userId: created.id,
      actorUserId: req.user?.id,
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
      payload: { email: parsed.data.email, role: parsed.data.role },
    });
    res.status(201).json({
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        status: created.status,
      },
    });
  });

  router.post(
    "/:id/suspend",
    requirePermission("user:suspend"),
    async (req: Request, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      // Self-suspend would orphan the actor's session AND potentially
      // remove the last active admin. Refuse outright.
      if (req.user?.id === id) {
        return problem(res, 409, "Conflict", "An admin cannot suspend their own account");
      }
      const lastAdminCheck = await wouldRemoveLastActiveAdmin(deps.db, id, "suspend");
      if (lastAdminCheck.blocked) {
        return problem(res, 409, "Conflict", lastAdminCheck.reason);
      }
      await deps.db.update(users).set({ status: "suspended" }).where(eq(users.id, id));
      await revokeAllUserSessions(deps.db, id);
      await recordAuthEvent(deps.db, {
        kind: "user.suspended",
        userId: id,
        actorUserId: req.user?.id,
        ip: clientIp(req),
      });
      res.status(204).send();
    },
  );

  router.post(
    "/:id/unsuspend",
    requirePermission("user:suspend"),
    async (req: Request, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      await deps.db.update(users).set({ status: "active" }).where(eq(users.id, id));
      await recordAuthEvent(deps.db, {
        kind: "user.unsuspended",
        userId: id,
        actorUserId: req.user?.id,
        ip: clientIp(req),
      });
      res.status(204).send();
    },
  );

  router.post(
    "/:id/role",
    requirePermission("user:invite"),
    async (req: Request, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = roleChangeSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid role");
      // Self-demote would lock the actor out of further admin work
      // and could orphan the firm if they're the only admin.
      if (req.user?.id === id && parsed.data.role !== "admin") {
        return problem(res, 409, "Conflict", "An admin cannot change their own role");
      }
      // Last-active-admin guard: refuse if changing this user's role
      // away from `admin` would leave zero active admins firm-wide.
      if (parsed.data.role !== "admin") {
        const lastAdminCheck = await wouldRemoveLastActiveAdmin(deps.db, id, "demote");
        if (lastAdminCheck.blocked) {
          return problem(res, 409, "Conflict", lastAdminCheck.reason);
        }
      }
      await deps.db.update(users).set({ role: parsed.data.role }).where(eq(users.id, id));
      await recordAuthEvent(deps.db, {
        kind: "user.role_changed",
        userId: id,
        actorUserId: req.user?.id,
        ip: clientIp(req),
        payload: { newRole: parsed.data.role },
      });
      res.status(204).send();
    },
  );

  router.post(
    "/:id/reset-password",
    requirePermission("user:reset-password"),
    async (req: Request, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const ip = clientIp(req);
      const [user] = await deps.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) return problem(res, 404, "Not found", "User not found");
      // Issue a magic link rather than emailing a temporary password.
      const issued = await issueMagicLink(deps.db, { userId: user.id, ip });
      const consumeUrl = `/login/magic?token=${issued.token}`;
      await deps.emitMagicLinkEmail({
        email: user.email,
        token: issued.token,
        consumeUrl,
        expiresAt: issued.expiresAt,
      });
      await recordAuthEvent(deps.db, {
        kind: "password.reset.requested",
        userId: user.id,
        actorUserId: req.user?.id,
        ip,
      });
      res.status(202).json({ accepted: true });
    },
  );

  router.post(
    "/:id/require-2fa",
    requirePermission("user:require-2fa"),
    async (req: Request, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      // Drop existing 2FA so the user re-enrolls; revoke sessions so
      // the next login pass triggers re-enrollment.
      await deps.db
        .update(users)
        .set({ totpEnabled: false, totpSecret: null })
        .where(eq(users.id, id));
      await deps.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, id));
      await revokeAllUserSessions(deps.db, id);
      await recordAuthEvent(deps.db, {
        kind: "user.totp_required",
        userId: id,
        actorUserId: req.user?.id,
        ip: clientIp(req),
      });
      res.status(204).send();
    },
  );

  router.post(
    "/clear-lockout",
    requirePermission("user:clear-lockout"),
    async (req: Request, res: Response) => {
      const parsed = clearLockoutSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      await deps.rateLimiter.adminClear(parsed.data.ip, parsed.data.email);
      await recordAuthEvent(deps.db, {
        kind: "lockout.cleared",
        actorUserId: req.user?.id,
        ip: clientIp(req),
        payload: { ip: parsed.data.ip, email: parsed.data.email },
      });
      res.status(204).send();
    },
  );

  return router;
}

void and; // keep the import path warm; future routes will use it.
