import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { calculations, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { permittedCalculationIds, userOwnsCalculation } from "../lib/ownership.js";

/**
 * Phase 20 — calculations CRUD lite.
 *
 * The full versioning + workflow lives in Phase 21. Phase 20 exposes
 * just enough to list/detail/archive so the workspace UI works.
 *
 *   GET    /api/v1/calculations              list (filterable)
 *   GET    /api/v1/calculations/:id          detail
 *   POST   /api/v1/calculations              create stub (preparer+)
 *   POST   /api/v1/calculations/:id/archive  soft-archive
 *   POST   /api/v1/calculations/:id/restore  un-archive
 */

export interface CalculationRouteDeps {
  db: Database;
}

const kindEnum = z.enum([
  "tvm.amortization",
  "tvm.bond",
  "tvm.lease_842",
  "tvm.tdr",
  "tvm.imputed_interest",
  "tvm.below_market_loan",
  "tvm.sinking_fund",
  "tvm.lease_factor",
  "tvm.note_yield",
  "tvm.irr_npv",
  "tvm.cash_flow_event_grid",
  "tax.macrs",
  "tax.section_179",
  "tax.bonus_depreciation",
  "tax.depreciation_combined",
  "tax.cost_seg",
  "tax.rmd",
  "tax.roth_conversion",
  "tax.capital_gains",
  "tax.qbi",
  "tax.safe_harbor",
  "tax.se_tax",
  "tax.state_estimate",
  "tax.amt",
  "tax.section_1031",
  "tax.installment_sale",
  "tax.section_121",
  "tax.irs_interest_penalty",
  "tax.hsa",
  "tax.qualified_plan",
  "tax.social_security_age",
  "other",
]);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  kind: kindEnum,
  clientId: z.string().min(1).optional(),
  engagementId: z.string().min(1).optional(),
  inputs: z.record(z.unknown()).default({}),
});

const listQuery = z.object({
  clientId: z.string().optional(),
  engagementId: z.string().optional(),
  kind: kindEnum.optional(),
  status: z.enum(["draft", "ready_for_review", "approved"]).optional(),
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

const bulkArchiveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export function buildCalculationsRouter(deps: CalculationRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("calculation:read"), async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid query");
    const conds = [];
    if (!parsed.data.includeArchived) conds.push(isNull(calculations.archivedAt));
    if (parsed.data.clientId) conds.push(eq(calculations.clientId, parsed.data.clientId));
    if (parsed.data.engagementId)
      conds.push(eq(calculations.engagementId, parsed.data.engagementId));
    if (parsed.data.kind) conds.push(eq(calculations.kind, parsed.data.kind));
    if (parsed.data.status) conds.push(eq(calculations.status, parsed.data.status));
    const rows = await deps.db
      .select()
      .from(calculations)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(calculations.updatedAt))
      .limit(parsed.data.limit ?? 100);
    res.json({ calculations: rows.map(serialize) });
  });

  router.post("/", requirePermission("calculation:create"), async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const userId = req.user?.id ?? null;
    const [row] = await deps.db
      .insert(calculations)
      .values({
        name: parsed.data.name,
        kind: parsed.data.kind,
        clientId: parsed.data.clientId ?? null,
        engagementId: parsed.data.engagementId ?? null,
        inputsJson: parsed.data.inputs,
        outputsJson: {},
        computedBy: userId,
        status: "draft",
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({ calculation: serialize(row) });
  });

  router.get("/:id", requirePermission("calculation:read"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = readIdParam(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    if (
      !(await userOwnsCalculation({ db: deps.db, userId: req.user.id, role: req.user.role }, id))
    ) {
      return problem(res, 404, "Not found", "Calculation not found");
    }
    const [row] = await deps.db.select().from(calculations).where(eq(calculations.id, id)).limit(1);
    if (!row) return problem(res, 404, "Not found", "Calculation not found");
    res.json({ calculation: serialize(row), inputs: row.inputsJson, outputs: row.outputsJson });
  });

  router.post(
    "/:id/archive",
    requirePermission("calculation:archive"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      if (
        !(await userOwnsCalculation({ db: deps.db, userId: req.user.id, role: req.user.role }, id))
      ) {
        return problem(res, 404, "Not found", "Calculation not found or already archived");
      }
      const [row] = await deps.db
        .update(calculations)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(calculations.id, id), isNull(calculations.archivedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Calculation not found or already archived");
      res.json({ calculation: serialize(row) });
    },
  );

  router.post(
    "/:id/restore",
    requirePermission("calculation:archive"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      if (
        !(await userOwnsCalculation({ db: deps.db, userId: req.user.id, role: req.user.role }, id))
      ) {
        return problem(res, 404, "Not found", "Calculation not found or not archived");
      }
      const [row] = await deps.db
        .update(calculations)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(calculations.id, id), isNotNull(calculations.archivedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Calculation not found or not archived");
      res.json({ calculation: serialize(row) });
    },
  );

  // Phase 20.7 — bulk archive. IDOR-scoped: only the caller's permitted
  // ids actually flip; non-permitted ids are silently ignored (the
  // response surfaces requested vs archivedIds so the caller can detect).
  router.post(
    "/bulk/archive",
    requirePermission("calculation:archive"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const parsed = bulkArchiveSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const permitted = await permittedCalculationIds(
        { db: deps.db, userId: req.user.id, role: req.user.role },
        parsed.data.ids,
      );
      if (permitted.length === 0) {
        return res.json({ archivedIds: [], requested: parsed.data.ids.length });
      }
      const updated = await deps.db
        .update(calculations)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(calculations.id, permitted), isNull(calculations.archivedAt)))
        .returning({ id: calculations.id });
      res.json({ archivedIds: updated.map((r) => r.id), requested: parsed.data.ids.length });
    },
  );

  return router;
}

function readIdParam(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function serialize(c: typeof calculations.$inferSelect) {
  return {
    id: c.id,
    engagementId: c.engagementId,
    clientId: c.clientId,
    kind: c.kind,
    name: c.name,
    status: c.status,
    version: c.version,
    computedAt: c.computedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
}
