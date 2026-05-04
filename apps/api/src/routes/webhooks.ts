import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { webhookSubscriptions, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 24.3 — webhook subscriptions.
 *
 *   GET    /api/v1/webhooks
 *   POST   /api/v1/webhooks    create (admin)
 *   DELETE /api/v1/webhooks/:id  archive
 *
 * Outbound delivery is handled by lib/webhook-dispatch.ts; the
 * dispatcher reads from this table and signs each request.
 */

export interface WebhooksRouteDeps {
  db: Database;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  actions: z.array(z.string()).default([]),
});

export function buildWebhooksRouter(deps: WebhooksRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), async (_req: Request, res: Response) => {
    const rows = await deps.db
      .select({
        id: webhookSubscriptions.id,
        name: webhookSubscriptions.name,
        url: webhookSubscriptions.url,
        actions: webhookSubscriptions.actions,
        createdAt: webhookSubscriptions.createdAt,
        lastFiredAt: webhookSubscriptions.lastFiredAt,
        lastFailureMessage: webhookSubscriptions.lastFailureMessage,
        archivedAt: webhookSubscriptions.archivedAt,
      })
      .from(webhookSubscriptions)
      .where(isNull(webhookSubscriptions.archivedAt))
      .orderBy(desc(webhookSubscriptions.createdAt))
      .limit(200);
    res.json({ webhooks: rows });
  });

  router.post("/", requirePermission("user:invite"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const [row] = await deps.db
      .insert(webhookSubscriptions)
      .values({
        name: parsed.data.name,
        url: parsed.data.url,
        actions: parsed.data.actions,
        secret,
        createdBy: req.user.id,
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({
      webhook: {
        id: row.id,
        name: row.name,
        url: row.url,
        actions: row.actions,
        createdAt: row.createdAt.toISOString(),
      },
      secret,
      warning: "Copy the signing secret now — it cannot be retrieved later.",
    });
  });

  router.delete("/:id", requirePermission("user:invite"), async (req: Request, res: Response) => {
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [row] = await deps.db
      .update(webhookSubscriptions)
      .set({ archivedAt: new Date() })
      .where(and(eq(webhookSubscriptions.id, id), isNull(webhookSubscriptions.archivedAt)))
      .returning();
    if (!row) return problem(res, 404, "Not found", "Webhook not found or already archived");
    res.status(204).end();
  });

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}
