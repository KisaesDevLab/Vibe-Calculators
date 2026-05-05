import { Router, type Request, type Response } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { exportJobs, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { enqueueExport, EXPORT_ROOT_DIR, type ExportQueueDeps } from "../lib/export-queue.js";
import { permittedCalculationIds } from "../lib/ownership.js";

/**
 * Phase 13.7 — async export REST surface.
 *
 *   POST /api/v1/exports          enqueue (returns 202 + job id)
 *   GET  /api/v1/exports          list mine (last 100)
 *   GET  /api/v1/exports/:id      status
 *   GET  /api/v1/exports/:id/download   stream the file
 *   POST /api/v1/exports/:id/cancel     mark queued/processing as failed
 *
 * Single-calc kinds (tvm-pdf / memo-pdf / xlsx / csv / docx) read
 * `calculationId`. The `bulk-zip` kind reads `calculationIds[]` and
 * caps at 50 per call (matched by the queue lib).
 */

export interface ExportRouteDeps {
  /**
   * Async export queue. Optional — integration tests that don't
   * exercise queue routes can omit this and the router falls back
   * to a 503 on enqueue. The HTTP entry point passes the real value.
   */
  exportQueue?: ExportQueueDeps | undefined;
}

interface InternalDeps {
  db: Database;
  queue?: ExportQueueDeps | undefined;
}

const enqueueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tvm-pdf"),
    calculationId: z.string().min(1),
    options: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("memo-pdf"),
    calculationId: z.string().min(1),
    options: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("xlsx"),
    calculationId: z.string().min(1),
    options: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("csv"),
    calculationId: z.string().min(1),
    options: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("docx"),
    calculationId: z.string().min(1),
    options: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("bulk-zip"),
    calculationIds: z.array(z.string().min(1)).min(1).max(50),
    options: z.record(z.unknown()).optional(),
  }),
]);

export function buildExportsRouter(deps: InternalDeps): Router {
  const router = Router();

  router.post("/", requirePermission("export:create"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    if (!deps.queue) {
      return problem(res, 503, "Service unavailable", "Export queue not configured");
    }
    const parsed = enqueueSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const ids =
      parsed.data.kind === "bulk-zip" ? parsed.data.calculationIds : [parsed.data.calculationId];
    const allowed = await permittedCalculationIds(
      { db: deps.db, userId: req.user.id, role: req.user.role },
      ids,
    );
    if (allowed.length === 0) {
      return problem(res, 404, "Not found", "No matching calculations in scope");
    }
    if (parsed.data.kind === "bulk-zip" && allowed.length !== ids.length) {
      return problem(
        res,
        403,
        "Forbidden",
        `Some calculations are not in your scope (${allowed.length}/${ids.length} permitted)`,
      );
    }

    const queueDeps = deps.queue;
    const row = await enqueueExport(queueDeps, {
      kind: parsed.data.kind,
      ...(parsed.data.kind === "bulk-zip"
        ? { calculationIds: parsed.data.calculationIds }
        : { calculationId: parsed.data.calculationId }),
      options: parsed.data.options ?? {},
      requestedBy: req.user.id,
    });

    res.status(202).json({ exportJob: serialize(row) });
  });

  router.get("/", requirePermission("export:create"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const rows = await deps.db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.requestedBy, req.user.id))
      .orderBy(desc(exportJobs.requestedAt))
      .limit(100);
    res.json({ exportJobs: rows.map(serialize) });
  });

  router.get("/:id", requirePermission("export:create"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = idParam(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [row] = await deps.db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, id), eq(exportJobs.requestedBy, req.user.id)))
      .limit(1);
    if (!row) return problem(res, 404, "Not found", "Export job not found");
    res.json({ exportJob: serialize(row) });
  });

  router.get(
    "/:id/download",
    requirePermission("export:download"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = idParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, id), eq(exportJobs.requestedBy, req.user.id)))
        .limit(1);
      if (!row) return problem(res, 404, "Not found", "Export job not found");
      if (row.status !== "done") {
        return problem(res, 409, "Not ready", `Export status is ${row.status}`);
      }
      if (!row.filePath || !row.filename) {
        return problem(res, 410, "Gone", "Export file has been removed (retention sweep)");
      }
      // Containment check: the resolved path must stay under
      // EXPORT_ROOT_DIR. Defense against any future path-traversal
      // bug in how filePath gets persisted.
      const resolved = path.resolve(row.filePath);
      if (!resolved.startsWith(path.resolve(EXPORT_ROOT_DIR) + path.sep)) {
        return problem(res, 500, "Internal error", "Export path outside data dir");
      }
      try {
        await fs.access(resolved);
      } catch {
        return problem(res, 410, "Gone", "Export file missing on disk");
      }
      res.setHeader("Content-Type", contentTypeFor(row.filename));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sanitizeFilename(row.filename)}"`,
      );
      res.sendFile(resolved);
    },
  );

  router.post(
    "/:id/cancel",
    requirePermission("export:create"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = idParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, id), eq(exportJobs.requestedBy, req.user.id)))
        .limit(1);
      if (!row) return problem(res, 404, "Not found", "Export job not found");
      if (row.status === "done" || row.status === "failed") {
        return problem(res, 409, "Conflict", `Cannot cancel a ${row.status} job`);
      }
      const [updated] = await deps.db
        .update(exportJobs)
        .set({ status: "failed", errorMessage: "Cancelled by user", completedAt: new Date() })
        .where(eq(exportJobs.id, id))
        .returning();
      res.json({ exportJob: updated ? serialize(updated) : null });
    },
  );

  return router;
}

function idParam(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function serialize(row: typeof exportJobs.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    calculationId: row.calculationId,
    calculationIds: row.calculationIds,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    progress: row.progress,
    errorMessage: row.errorMessage,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "csv":
      return "text/csv; charset=utf-8";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
