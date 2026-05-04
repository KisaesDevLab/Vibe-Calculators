import { Router, type Request, type Response } from "express";
import { and, inArray, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { calculations, engagements, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 20.7 — bulk actions.
 *
 *   POST /api/v1/bulk/calculations/archive
 *   POST /api/v1/bulk/calculations/restore
 *   POST /api/v1/bulk/calculations/change-tax-year   (drives the engagement tax_year)
 *   POST /api/v1/bulk/engagements/reassign
 *
 * The export bulk action is provided by the existing PDF/CSV/XLSX
 * pipeline via per-calculation export endpoints; bulk export is
 * handled client-side by chaining individual fetches with progress
 * UI (deferred to Phase 22 alongside scheduled deliveries).
 */

export interface BulkRouteDeps {
  db: Database;
}

const idsSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

const changeTaxYearSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  taxYear: z.number().int().min(1900).max(2200).nullable(),
});

const reassignSchema = z.object({
  engagementIds: z.array(z.string().min(1)).min(1).max(200),
  preparerId: z.string().min(1).nullable().optional(),
  reviewerId: z.string().min(1).nullable().optional(),
});

export function buildBulkRouter(deps: BulkRouteDeps): Router {
  const router = Router();

  router.post(
    "/calculations/archive",
    requirePermission("calculation:archive"),
    async (req: Request, res: Response) => {
      const parsed = idsSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const updated = await deps.db
        .update(calculations)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(calculations.id, parsed.data.ids), isNull(calculations.archivedAt)))
        .returning({ id: calculations.id });
      res.json({ updatedIds: updated.map((r) => r.id), requested: parsed.data.ids.length });
    },
  );

  router.post(
    "/calculations/restore",
    requirePermission("calculation:archive"),
    async (req: Request, res: Response) => {
      const parsed = idsSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const updated = await deps.db
        .update(calculations)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(inArray(calculations.id, parsed.data.ids), isNotNull(calculations.archivedAt)))
        .returning({ id: calculations.id });
      res.json({ updatedIds: updated.map((r) => r.id), requested: parsed.data.ids.length });
    },
  );

  router.post(
    "/calculations/change-tax-year",
    requirePermission("engagement:update"),
    async (req: Request, res: Response) => {
      const parsed = changeTaxYearSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      // Calculations don't carry tax_year directly; the change cascades through the engagement.
      const calcs = await deps.db
        .select({ engagementId: calculations.engagementId })
        .from(calculations)
        .where(inArray(calculations.id, parsed.data.ids));
      const engagementIds = [
        ...new Set(calcs.map((c) => c.engagementId).filter((x): x is string => Boolean(x))),
      ];
      if (engagementIds.length === 0) {
        return res.json({ updatedEngagements: 0, taxYear: parsed.data.taxYear });
      }
      const updated = await deps.db
        .update(engagements)
        .set({ taxYear: parsed.data.taxYear, updatedAt: new Date() })
        .where(inArray(engagements.id, engagementIds))
        .returning({ id: engagements.id });
      res.json({ updatedEngagements: updated.length, taxYear: parsed.data.taxYear });
    },
  );

  router.post(
    "/engagements/reassign",
    requirePermission("engagement:assign"),
    async (req: Request, res: Response) => {
      const parsed = reassignSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.preparerId !== undefined) patch.assignedPreparerId = parsed.data.preparerId;
      if (parsed.data.reviewerId !== undefined) patch.assignedReviewerId = parsed.data.reviewerId;
      if (Object.keys(patch).length === 1) {
        return problem(res, 400, "Bad request", "Provide preparerId or reviewerId");
      }
      const updated = await deps.db
        .update(engagements)
        .set(patch)
        .where(inArray(engagements.id, parsed.data.engagementIds))
        .returning({ id: engagements.id });
      res.json({
        updatedIds: updated.map((r) => r.id),
        requested: parsed.data.engagementIds.length,
      });
    },
  );

  return router;
}
