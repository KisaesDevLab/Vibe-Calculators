import { Router, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { taxYearTables, taxYearOverrides, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 14.6 — admin browse-by-year tax tables.
 *
 *   GET /api/v1/admin/tax-tables?year=2024&kind=federal_tax_brackets
 *
 * Read-only. Returns the seed rows + any overrides that apply to the
 * given (year, kind). Operators consult this when answering "what
 * value did the engine use for this year's bracket?"
 */

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
    res.json({ years });
  });

  return router;
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
