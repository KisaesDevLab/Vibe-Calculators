import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { auditEvents, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { validateAuditEventChain } from "../lib/audit-events.js";

/**
 * Phase 21.3 — admin audit-log read endpoints.
 *
 *   GET /api/v1/audit/events                  list with filters
 *   GET /api/v1/audit/events/by-entity/:kind/:id   per-entity replay
 *   GET /api/v1/audit/chain/validate          tamper check
 */

export interface AuditRouteDeps {
  db: Database;
}

const ENTITY_KINDS = new Set([
  "client",
  "engagement",
  "calculation",
  "calculation_version",
  "tag",
  "user",
]);

export function buildAuditRouter(deps: AuditRouteDeps): Router {
  const router = Router();

  router.get("/events", requirePermission("audit:read"), async (req: Request, res: Response) => {
    const limit = clamp(Number(req.query.limit ?? 100), 1, 500);
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const conds = action ? [eq(auditEvents.action, action as never)] : [];
    const rows = await deps.db
      .select()
      .from(auditEvents)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    res.json({ events: rows });
  });

  router.get(
    "/events/by-entity/:kind/:id",
    requirePermission("audit:read"),
    async (req: Request, res: Response) => {
      const kind = typeof req.params.kind === "string" ? req.params.kind : "";
      const id = typeof req.params.id === "string" ? req.params.id : "";
      if (!ENTITY_KINDS.has(kind)) return problem(res, 400, "Bad request", "Unknown entity kind");
      if (!id) return problem(res, 400, "Bad request", "Missing entity id");
      const rows = await deps.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityKind, kind as never), eq(auditEvents.entityId, id)))
        .orderBy(desc(auditEvents.createdAt));
      res.json({ events: rows });
    },
  );

  router.get(
    "/chain/validate",
    requirePermission("audit:read"),
    async (_req: Request, res: Response) => {
      const result = await validateAuditEventChain(deps.db);
      res.json(result);
    },
  );

  return router;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
