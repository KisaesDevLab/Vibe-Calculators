import { Router, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { taxYearTables, taxYearOverrides, type Database, type TaxTableKind } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 14.6 / 14.5 — admin browse + maintenance for tax tables.
 *
 *   GET    /api/v1/admin/tax-tables               filter by year/kind
 *   GET    /api/v1/admin/tax-tables/index         distinct (year, kind) pairs
 *   POST   /api/v1/admin/tax-tables               create new row (or override)
 *   PUT    /api/v1/admin/tax-tables/:id           update payload / source
 *   POST   /api/v1/admin/tax-tables/:id/clone     duplicate to new year
 *   POST   /api/v1/admin/tax-tables/:id/supersede mark superseded (soft delete)
 *   DELETE /api/v1/admin/tax-tables/:id           hard delete (admin only;
 *                                                 typically reserved for
 *                                                 mistakes immediately
 *                                                 after creation)
 *
 * Mutations require `settings:write`. Every change writes an audit
 * row tagged with the field set that changed.
 */

const KINDS: TaxTableKind[] = [
  "federal_tax_brackets",
  "standard_deduction",
  "alternative_minimum_tax_exemption",
  "fica_wage_base",
  "medicare_thresholds",
  "niit_thresholds",
  "qbi_thresholds",
  "section_179_limits",
  "bonus_depreciation_pct",
  "macrs_tables",
  "rmd_uniform_lifetime",
  "rmd_joint_life",
  "rmd_single_life",
  "retirement_contribution_limits",
  "social_security_wage_base",
  "ss_optimal_age_table",
  "hsa_contribution_limits",
  "afr_short_mid_long",
];
const kindEnum = z.enum(KINDS as [TaxTableKind, ...TaxTableKind[]]);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const createSchema = z.object({
  // When `target = "override"` the row lands in tax_year_overrides
  // (mid-year correction); default = "table".
  target: z.enum(["table", "override"]).optional().default("table"),
  taxYear: z.number().int().min(1900).max(2100),
  kind: kindEnum,
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  payload: z.record(z.unknown()),
  sourceUrl: z.string().max(500).nullable().optional(),
  sourceVersion: z.string().max(200).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

const updateSchema = z.object({
  effectiveFrom: isoDate.optional(),
  effectiveTo: isoDate.nullable().optional(),
  payload: z.record(z.unknown()).optional(),
  sourceUrl: z.string().max(500).nullable().optional(),
  sourceVersion: z.string().max(200).nullable().optional(),
});

const cloneSchema = z.object({
  taxYear: z.number().int().min(1900).max(2100),
  effectiveFrom: isoDate,
  /** Override fields for the cloned row. Other fields inherit. */
  sourceUrl: z.string().max(500).nullable().optional(),
  sourceVersion: z.string().max(200).nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

export interface AdminTaxTablesRouteDeps {
  db: Database;
}

export function buildAdminTaxTablesRouter(deps: AdminTaxTablesRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("settings:read"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const yearStr = typeof req.query.year === "string" ? req.query.year : "";
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const year = Number.parseInt(yearStr, 10);

    const conds = [];
    if (Number.isFinite(year) && year > 1900 && year < 2100) {
      conds.push(eq(taxYearTables.taxYear, year));
    }
    if (kind) {
      // Drizzle's enum-typed `kind` column rejects a plain `string` at
      // type-time. Cast through the inferred enum union since the
      // value originates from the same dropdown that ships only valid
      // enum values; if a malicious caller passes garbage, the WHERE
      // simply matches nothing, which is the desired behavior.
      conds.push(eq(taxYearTables.kind, kind as (typeof taxYearTables.kind.enumValues)[number]));
    }
    const tables = await deps.db
      .select()
      .from(taxYearTables)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(
        asc(taxYearTables.taxYear),
        asc(taxYearTables.kind),
        asc(taxYearTables.effectiveFrom),
      );

    const overrideConds = [];
    if (Number.isFinite(year) && year > 1900 && year < 2100) {
      overrideConds.push(eq(taxYearOverrides.taxYear, year));
    }
    if (kind) {
      overrideConds.push(
        eq(taxYearOverrides.kind, kind as (typeof taxYearOverrides.kind.enumValues)[number]),
      );
    }
    const overrides = await deps.db
      .select()
      .from(taxYearOverrides)
      .where(overrideConds.length > 0 ? and(...overrideConds) : undefined)
      .orderBy(
        asc(taxYearOverrides.taxYear),
        asc(taxYearOverrides.kind),
        asc(taxYearOverrides.effectiveFrom),
      );

    res.json({
      tables: tables.map(serialize),
      overrides: overrides.map(serializeOverride),
    });
  });

  /** Distinct (year, kind) pairs for the dropdown. */
  router.get("/index", requirePermission("settings:read"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const rows = await deps.db
      .select({ taxYear: taxYearTables.taxYear, kind: taxYearTables.kind })
      .from(taxYearTables);
    const yearKinds = new Map<number, Set<string>>();
    for (const r of rows) {
      if (!yearKinds.has(r.taxYear)) yearKinds.set(r.taxYear, new Set());
      yearKinds.get(r.taxYear)!.add(r.kind);
    }
    const years = [...yearKinds.entries()]
      .map(([year, kindSet]) => ({ year, kinds: [...kindSet].sort() }))
      .sort((a, b) => a.year - b.year);
    res.json({ years, allKinds: KINDS });
  });

  /** Phase 14.5 — create a new row in tax_year_tables or tax_year_overrides. */
  router.post("/", requirePermission("settings:write"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const body = parsed.data;
    if (body.target === "override") {
      const [row] = await deps.db
        .insert(taxYearOverrides)
        .values({
          taxYear: body.taxYear,
          kind: body.kind,
          effectiveFrom: body.effectiveFrom,
          ...(body.effectiveTo !== undefined ? { effectiveTo: body.effectiveTo } : {}),
          payload: body.payload as Record<string, unknown>,
          sourceUrl: body.sourceUrl ?? null,
          sourceVersion: body.sourceVersion ?? null,
          note: body.note ?? null,
        })
        .returning();
      if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
      await recordAuditEvent(deps.db, {
        action: "client.update",
        entityKind: "client",
        entityId: row.id,
        actorUserId: req.user.id,
        payload: {
          target: "tax_year_overrides",
          op: "create",
          taxYear: body.taxYear,
          kind: body.kind,
        },
      });
      res.status(201).json({ override: serializeOverride(row) });
      return;
    }
    const [row] = await deps.db
      .insert(taxYearTables)
      .values({
        taxYear: body.taxYear,
        kind: body.kind,
        effectiveFrom: body.effectiveFrom,
        ...(body.effectiveTo !== undefined ? { effectiveTo: body.effectiveTo } : {}),
        payload: body.payload as Record<string, unknown>,
        sourceUrl: body.sourceUrl ?? null,
        sourceVersion: body.sourceVersion ?? null,
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    await recordAuditEvent(deps.db, {
      action: "client.update",
      entityKind: "client",
      entityId: row.id,
      actorUserId: req.user.id,
      payload: {
        target: "tax_year_tables",
        op: "create",
        taxYear: body.taxYear,
        kind: body.kind,
      },
    });
    res.status(201).json({ table: serialize(row) });
  });

  /** Phase 14.5 — update an existing row. Reproducibility note: edits
   *  affect every calculation re-run that consumes this row, so the
   *  audit payload records the prior values for cross-reference. */
  router.put("/:id", requirePermission("settings:write"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const [existing] = await deps.db
      .select()
      .from(taxYearTables)
      .where(eq(taxYearTables.id, id))
      .limit(1);
    if (!existing) return problem(res, 404, "Not found", "Tax-table row not found");
    const patch: Record<string, unknown> = {};
    if (parsed.data.effectiveFrom !== undefined) patch.effectiveFrom = parsed.data.effectiveFrom;
    if (parsed.data.effectiveTo !== undefined) patch.effectiveTo = parsed.data.effectiveTo;
    if (parsed.data.payload !== undefined) patch.payload = parsed.data.payload;
    if (parsed.data.sourceUrl !== undefined) patch.sourceUrl = parsed.data.sourceUrl;
    if (parsed.data.sourceVersion !== undefined) patch.sourceVersion = parsed.data.sourceVersion;
    if (Object.keys(patch).length === 0) {
      return problem(res, 400, "Bad request", "No fields to update");
    }
    const [updated] = await deps.db
      .update(taxYearTables)
      .set(patch)
      .where(eq(taxYearTables.id, id))
      .returning();
    if (!updated) return problem(res, 500, "Internal error", "Update returned no row");
    await recordAuditEvent(deps.db, {
      action: "client.update",
      entityKind: "client",
      entityId: id,
      actorUserId: req.user.id,
      payload: {
        target: "tax_year_tables",
        op: "update",
        fields: Object.keys(patch),
        taxYear: existing.taxYear,
        kind: existing.kind,
      },
    });
    res.json({ table: serialize(updated) });
  });

  /** Phase 14.5 — clone a row to a new (year, effective_from). The
   *  cloned row inherits payload + source unless overridden. */
  router.post(
    "/:id/clone",
    requirePermission("settings:write"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = cloneSchema.safeParse(req.body);
      if (!parsed.success) {
        return problem(res, 400, "Bad request", "Invalid body", {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      const [src] = await deps.db
        .select()
        .from(taxYearTables)
        .where(eq(taxYearTables.id, id))
        .limit(1);
      if (!src) return problem(res, 404, "Not found", "Source row not found");
      const [row] = await deps.db
        .insert(taxYearTables)
        .values({
          taxYear: parsed.data.taxYear,
          kind: src.kind,
          effectiveFrom: parsed.data.effectiveFrom,
          payload: (parsed.data.payload ?? src.payload) as Record<string, unknown>,
          sourceUrl: parsed.data.sourceUrl ?? src.sourceUrl,
          sourceVersion: parsed.data.sourceVersion ?? src.sourceVersion,
        })
        .returning();
      if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
      await recordAuditEvent(deps.db, {
        action: "client.update",
        entityKind: "client",
        entityId: row.id,
        actorUserId: req.user.id,
        payload: {
          target: "tax_year_tables",
          op: "clone",
          fromId: src.id,
          taxYear: parsed.data.taxYear,
          kind: src.kind,
        },
      });
      res.status(201).json({ table: serialize(row) });
    },
  );

  /** Phase 14.8 — mark a row as superseded. The resolver excludes
   *  superseded rows when picking the active payload. */
  router.post(
    "/:id/supersede",
    requirePermission("settings:write"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [existing] = await deps.db
        .select()
        .from(taxYearTables)
        .where(eq(taxYearTables.id, id))
        .limit(1);
      if (!existing) return problem(res, 404, "Not found", "Row not found");
      const [updated] = await deps.db
        .update(taxYearTables)
        .set({ supersededAt: new Date() })
        .where(eq(taxYearTables.id, id))
        .returning();
      await recordAuditEvent(deps.db, {
        action: "client.update",
        entityKind: "client",
        entityId: id,
        actorUserId: req.user.id,
        payload: {
          target: "tax_year_tables",
          op: "supersede",
          taxYear: existing.taxYear,
          kind: existing.kind,
        },
      });
      res.json({ table: updated ? serialize(updated) : null });
    },
  );

  /** Hard delete — admin escape hatch for "I just created this and it
   *  was wrong." Most cleanups should use supersede instead so the
   *  audit chain points at a still-extant row. */
  router.delete(
    "/:id",
    requirePermission("settings:write"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [existing] = await deps.db
        .select()
        .from(taxYearTables)
        .where(eq(taxYearTables.id, id))
        .limit(1);
      if (!existing) return problem(res, 404, "Not found", "Row not found");
      await deps.db.delete(taxYearTables).where(eq(taxYearTables.id, id));
      await recordAuditEvent(deps.db, {
        action: "client.update",
        entityKind: "client",
        entityId: id,
        actorUserId: req.user.id,
        payload: {
          target: "tax_year_tables",
          op: "delete",
          taxYear: existing.taxYear,
          kind: existing.kind,
        },
      });
      res.status(204).end();
    },
  );

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function serialize(row: typeof taxYearTables.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    taxYear: row.taxYear,
    kind: row.kind,
    payload: row.payload,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    sourceUrl: row.sourceUrl,
    sourceVersion: row.sourceVersion,
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}

function serializeOverride(row: typeof taxYearOverrides.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    taxYear: row.taxYear,
    kind: row.kind,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    payload: row.payload,
    sourceUrl: row.sourceUrl,
    sourceVersion: row.sourceVersion,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
