import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { engagements, calculations, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 20.6 — "My queue" dashboard.
 *
 *   GET /api/v1/queue
 *
 * Returns engagements assigned to the requester (preparer or
 * reviewer) plus calculations tied to those engagements. Each item
 * carries an SLA flag computed at request time:
 *   - in_review > 3 days  → flagged
 *
 * Calling this without auth is rejected by requirePermission.
 */

export interface QueueRouteDeps {
  db: Database;
}

const SLA_DAYS = 3;
const SLA_MS = SLA_DAYS * 86_400_000;

export function buildQueueRouter(deps: QueueRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("engagement:read"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const userId = req.user.id;
    const myEngagements = await deps.db
      .select()
      .from(engagements)
      .where(
        and(
          isNull(engagements.archivedAt),
          or(
            eq(engagements.assignedPreparerId, userId),
            eq(engagements.assignedReviewerId, userId),
          )!,
        ),
      )
      .orderBy(desc(engagements.updatedAt))
      .limit(100);

    const engagementIds = myEngagements.map((e) => e.id);
    const myCalcs =
      engagementIds.length === 0
        ? []
        : await deps.db
            .select()
            .from(calculations)
            .where(
              and(isNull(calculations.archivedAt), eq(calculations.status, "ready_for_review")),
            )
            .orderBy(desc(calculations.updatedAt))
            .limit(100);

    const now = Date.now();
    const enriched = myEngagements.map((e) => {
      const flagged = e.status === "in_review" && now - e.updatedAt.getTime() > SLA_MS;
      return {
        id: e.id,
        clientId: e.clientId,
        name: e.name,
        taxYear: e.taxYear,
        status: e.status,
        engagementType: e.engagementType,
        assignedPreparerId: e.assignedPreparerId,
        assignedReviewerId: e.assignedReviewerId,
        updatedAt: e.updatedAt.toISOString(),
        slaFlagged: flagged,
        daysSinceUpdate: Math.floor((now - e.updatedAt.getTime()) / 86_400_000),
      };
    });

    const calcsForMyEngagements = myCalcs.filter(
      (c) => c.engagementId !== null && engagementIds.includes(c.engagementId),
    );

    res.json({
      myEngagements: enriched,
      pendingReviewCalculations: calcsForMyEngagements.map((c) => ({
        id: c.id,
        engagementId: c.engagementId,
        kind: c.kind,
        name: c.name,
        status: c.status,
        updatedAt: c.updatedAt.toISOString(),
      })),
      slaThresholdDays: SLA_DAYS,
    });
  });

  return router;
}
