import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { engagements, calculations, entityTags, tags, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 20.3 — engagements CRUD + workflow + assignments.
 *
 * Endpoints:
 *   GET    /api/v1/engagements                  list (filterable)
 *   POST   /api/v1/engagements                  create (preparer+)
 *   GET    /api/v1/engagements/:id              detail
 *   PATCH  /api/v1/engagements/:id              update (preparer+)
 *   POST   /api/v1/engagements/:id/assign       reviewer-only (assign preparer/reviewer)
 *   POST   /api/v1/engagements/:id/transition   workflow transition (draft -> in_review -> approved -> closed)
 *   POST   /api/v1/engagements/:id/archive
 *   POST   /api/v1/engagements/:id/restore
 */

export interface EngagementRouteDeps {
  db: Database;
}

const engagementTypeEnum = z.enum([
  "tax_planning",
  "tax_prep",
  "advisory",
  "loan_modeling",
  "audit_support",
  "other",
]);

const statusEnum = z.enum(["draft", "in_review", "approved", "closed"]);

const createSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(200),
  taxYear: z.number().int().min(1900).max(2200).nullable().optional(),
  engagementType: engagementTypeEnum.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  taxYear: z.number().int().min(1900).max(2200).nullable().optional(),
  engagementType: engagementTypeEnum.optional(),
});

const assignSchema = z.object({
  preparerId: z.string().min(1).nullable().optional(),
  reviewerId: z.string().min(1).nullable().optional(),
});

const transitionSchema = z.object({
  to: statusEnum,
});

const listQuery = z.object({
  clientId: z.string().optional(),
  taxYear: z.string().regex(/^\d+$/u).transform(Number).optional(),
  status: statusEnum.optional(),
  assignedTo: z.string().optional(),
  includeArchived: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  limit: z
    .string()
    .regex(/^\d+$/u)
    .transform((s) => Math.min(500, Math.max(1, Number(s))))
    .optional(),
});

const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["closed", "in_review"],
  closed: [],
};

export function buildEngagementsRouter(deps: EngagementRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("engagement:read"), async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid query");
    const conds = [];
    if (!parsed.data.includeArchived) conds.push(isNull(engagements.archivedAt));
    if (parsed.data.clientId) conds.push(eq(engagements.clientId, parsed.data.clientId));
    if (parsed.data.taxYear !== undefined) conds.push(eq(engagements.taxYear, parsed.data.taxYear));
    if (parsed.data.status) conds.push(eq(engagements.status, parsed.data.status));
    const rows = await deps.db
      .select()
      .from(engagements)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(engagements.updatedAt))
      .limit(parsed.data.limit ?? 100);
    res.json({ engagements: rows.map(serializeEngagement) });
  });

  router.post("/", requirePermission("engagement:create"), async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const [row] = await deps.db
      .insert(engagements)
      .values({
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        taxYear: parsed.data.taxYear ?? null,
        engagementType: parsed.data.engagementType ?? "advisory",
        status: "draft",
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({ engagement: serializeEngagement(row) });
  });

  router.get("/:id", requirePermission("engagement:read"), async (req: Request, res: Response) => {
    const id = readIdParam(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [row] = await deps.db.select().from(engagements).where(eq(engagements.id, id)).limit(1);
    if (!row) return problem(res, 404, "Not found", "Engagement not found");
    const calcs = await deps.db
      .select()
      .from(calculations)
      .where(and(eq(calculations.engagementId, id), isNull(calculations.archivedAt)))
      .orderBy(desc(calculations.updatedAt));
    const tagRows = await deps.db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(entityTags)
      .innerJoin(tags, eq(entityTags.tagId, tags.id))
      .where(and(eq(entityTags.entityKind, "engagement"), eq(entityTags.entityId, id)));
    res.json({
      engagement: serializeEngagement(row),
      calculations: calcs.map(serializeCalculation),
      tags: tagRows,
    });
  });

  router.patch(
    "/:id",
    requirePermission("engagement:update"),
    async (req: Request, res: Response) => {
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.taxYear !== undefined) patch.taxYear = parsed.data.taxYear;
      if (parsed.data.engagementType !== undefined)
        patch.engagementType = parsed.data.engagementType;
      const [row] = await deps.db
        .update(engagements)
        .set(patch)
        .where(eq(engagements.id, id))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Engagement not found");
      res.json({ engagement: serializeEngagement(row) });
    },
  );

  router.post(
    "/:id/assign",
    requirePermission("engagement:assign"),
    async (req: Request, res: Response) => {
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.preparerId !== undefined) patch.assignedPreparerId = parsed.data.preparerId;
      if (parsed.data.reviewerId !== undefined) patch.assignedReviewerId = parsed.data.reviewerId;
      const [row] = await deps.db
        .update(engagements)
        .set(patch)
        .where(eq(engagements.id, id))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Engagement not found");
      res.json({ engagement: serializeEngagement(row) });
    },
  );

  router.post("/:id/transition", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = readIdParam(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
    const [current] = await deps.db
      .select()
      .from(engagements)
      .where(eq(engagements.id, id))
      .limit(1);
    if (!current) return problem(res, 404, "Not found", "Engagement not found");
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(parsed.data.to)) {
      return problem(
        res,
        409,
        "Conflict",
        `Cannot transition from ${current.status} to ${parsed.data.to}`,
      );
    }
    // Approval requires reviewer role; submit-for-review is preparer-tier.
    if (
      parsed.data.to === "approved" &&
      req.user.role !== "admin" &&
      req.user.role !== "reviewer"
    ) {
      return problem(res, 403, "Forbidden", "Only reviewer/admin can approve");
    }
    const [row] = await deps.db
      .update(engagements)
      .set({ status: parsed.data.to, updatedAt: new Date() })
      .where(eq(engagements.id, id))
      .returning();
    if (!row) return problem(res, 404, "Not found", "Engagement not found");
    res.json({ engagement: serializeEngagement(row) });
  });

  router.post(
    "/:id/archive",
    requirePermission("engagement:archive"),
    async (req: Request, res: Response) => {
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(engagements)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(engagements.id, id), isNull(engagements.archivedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Engagement not found or already archived");
      res.json({ engagement: serializeEngagement(row) });
    },
  );

  router.post(
    "/:id/restore",
    requirePermission("engagement:archive"),
    async (req: Request, res: Response) => {
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(engagements)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(engagements.id, id), isNotNull(engagements.archivedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Engagement not found or not archived");
      res.json({ engagement: serializeEngagement(row) });
    },
  );

  return router;
}

function readIdParam(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function serializeEngagement(e: typeof engagements.$inferSelect) {
  return {
    id: e.id,
    clientId: e.clientId,
    name: e.name,
    taxYear: e.taxYear,
    engagementType: e.engagementType,
    status: e.status,
    assignedPreparerId: e.assignedPreparerId,
    assignedReviewerId: e.assignedReviewerId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    archivedAt: e.archivedAt?.toISOString() ?? null,
  };
}

function serializeCalculation(c: typeof calculations.$inferSelect) {
  return {
    id: c.id,
    engagementId: c.engagementId,
    clientId: c.clientId,
    kind: c.kind,
    name: c.name,
    status: c.status,
    version: c.version,
    computedAt: c.computedAt?.toISOString() ?? null,
    updatedAt: c.updatedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
}
