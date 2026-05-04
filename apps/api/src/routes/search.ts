import { Router, type Request, type Response } from "express";
import { desc, ilike, or, sql, type SQL } from "drizzle-orm";
import { clients, engagements, calculations, type Database } from "@vibe-calc/db";
import { requirePermission } from "../middleware/auth.js";

/**
 * Phase 20.5 — global search (cmd-K).
 *
 * Hits clients, engagements, and calculations including a substring
 * search inside `inputs_json` so a user can find calcs by a loan
 * amount, address, etc. Results are ranked by recency (updated_at
 * desc) within each entity bucket, capped at 8 per kind.
 *
 *   GET /api/v1/search?q=foo
 */

export interface SearchRouteDeps {
  db: Database;
}

interface SearchHit {
  kind: "client" | "engagement" | "calculation";
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string;
}

const PER_BUCKET = 8;

export function buildSearchRouter(deps: SearchRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("client:read"), async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) {
      res.json({ hits: [] satisfies SearchHit[] });
      return;
    }
    const like = `%${q}%`;

    const [clientRows, engagementRows, calculationRows] = await Promise.all([
      deps.db
        .select()
        .from(clients)
        .where(or(ilike(clients.name, like), ilike(clients.ein, like))!)
        .orderBy(desc(clients.updatedAt))
        .limit(PER_BUCKET),
      deps.db
        .select()
        .from(engagements)
        .where(ilike(engagements.name, like))
        .orderBy(desc(engagements.updatedAt))
        .limit(PER_BUCKET),
      deps.db
        .select()
        .from(calculations)
        .where(
          or(
            ilike(calculations.name, like),
            // Substring search inside the JSONB inputs (case-insensitive cast).
            sql`${calculations.inputsJson}::text ILIKE ${like}` satisfies SQL,
          )!,
        )
        .orderBy(desc(calculations.updatedAt))
        .limit(PER_BUCKET),
    ]);

    const hits: SearchHit[] = [
      ...clientRows.map((c) => ({
        kind: "client" as const,
        id: c.id,
        title: c.name,
        subtitle: `${c.entityType}${c.ein ? ` · EIN ${c.ein}` : ""}`,
        updatedAt: c.updatedAt.toISOString(),
      })),
      ...engagementRows.map((e) => ({
        kind: "engagement" as const,
        id: e.id,
        title: e.name,
        subtitle: `${e.engagementType}${e.taxYear ? ` · ${e.taxYear}` : ""} · ${e.status}`,
        updatedAt: e.updatedAt.toISOString(),
      })),
      ...calculationRows.map((c) => ({
        kind: "calculation" as const,
        id: c.id,
        title: c.name,
        subtitle: `${c.kind} · ${c.status}`,
        updatedAt: c.updatedAt.toISOString(),
      })),
    ];

    res.json({ hits });
  });

  return router;
}
