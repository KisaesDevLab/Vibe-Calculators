import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { generateToken } from "../lib/api-keys.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 24.2 — API key admin surface.
 *
 *   GET    /api/v1/admin/api-keys          list (admin)
 *   POST   /api/v1/admin/api-keys          issue (admin); plaintext returned ONCE
 *   POST   /api/v1/admin/api-keys/:id/revoke
 *
 * Requires the user-admin permission tier.
 */

export interface ApiKeysRouteDeps {
  db: Database;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default([]),
  actAsUserId: z.string().min(1).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export function buildApiKeysRouter(deps: ApiKeysRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), async (_req: Request, res: Response) => {
    const rows = await deps.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        actAsUserId: apiKeys.actAsUserId,
        issuedBy: apiKeys.issuedBy,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt))
      .limit(200);
    res.json({ apiKeys: rows });
  });

  router.post("/", requirePermission("user:invite"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });

    // Privilege-escalation guard: an issuer may only mint keys that
    // act as themselves. Issuing a key acting as a *different* user
    // requires admin role (which already has user:invite). For non-
    // admin issuers (e.g. reviewer extending integrations on their
    // own account), the only safe default is self.
    const targetUserId = parsed.data.actAsUserId ?? req.user.id;
    if (targetUserId !== req.user.id && req.user.role !== "admin") {
      return problem(res, 403, "Forbidden", "Only admin may issue API keys acting as another user");
    }

    const { plaintext, prefix, hash } = generateToken();
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
      : null;
    const [row] = await deps.db
      .insert(apiKeys)
      .values({
        name: parsed.data.name,
        prefix,
        tokenHash: hash,
        scopes: parsed.data.scopes,
        issuedBy: req.user.id,
        actAsUserId: targetUserId,
        expiresAt,
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");

    await recordAuditEvent(deps.db, {
      action: "client.create",
      entityKind: "user",
      entityId: row.id,
      actorUserId: req.user.id,
      payload: { name: row.name, scopes: row.scopes, prefix },
    });

    res.status(201).json({
      apiKey: {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
      plaintext,
      warning:
        "Copy this token now — it cannot be retrieved later. Store it in your secrets manager.",
    });
  });

  router.post(
    "/:id/revoke",
    requirePermission("user:invite"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "API key not found or already revoked");
      await recordAuditEvent(deps.db, {
        action: "client.archive",
        entityKind: "user",
        entityId: row.id,
        actorUserId: req.user.id,
        payload: { name: row.name, prefix: row.prefix },
      });
      res.json({ apiKey: { id: row.id, revokedAt: row.revokedAt?.toISOString() } });
    },
  );

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}
