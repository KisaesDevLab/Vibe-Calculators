import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  calculations,
  calculationVersions,
  calculationComments,
  type Database,
} from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 21 — versioning + reviewer/preparer workflow.
 *
 *   POST   /api/v1/calculations/:id/save            persist new immutable version
 *   GET    /api/v1/calculations/:id/versions        list version history
 *   GET    /api/v1/calculations/:id/versions/:vid   single version
 *   GET    /api/v1/calculations/:id/diff?a=v1&b=v2  shape diff
 *   POST   /api/v1/calculations/:id/rollback        new version copying an old one
 *   POST   /api/v1/calculations/:id/submit-for-review
 *   POST   /api/v1/calculations/:id/approve         reviewer-only; locks the version
 *   POST   /api/v1/calculations/:id/reject          reviewer-only; reverts to draft
 *   GET    /api/v1/calculations/:id/comments
 *   POST   /api/v1/calculations/:id/comments
 */

export interface VersioningRouteDeps {
  db: Database;
}

const saveSchema = z.object({
  inputs: z.record(z.unknown()),
  outputs: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
  rowAnnotations: z.record(z.string()).optional(),
});

const rollbackSchema = z.object({
  versionId: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  versionId: z.string().min(1).optional(),
  kind: z.enum(["note", "review_question", "review_response"]).default("note"),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

export function buildVersioningRouter(deps: VersioningRouteDeps): Router {
  const router = Router({ mergeParams: true });

  // Save = create new immutable version + bump pointer.
  router.post(
    "/save",
    requirePermission("calculation:update"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = saveSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");

      const [calc] = await deps.db
        .select()
        .from(calculations)
        .where(eq(calculations.id, id))
        .limit(1);
      if (!calc) return problem(res, 404, "Not found", "Calculation not found");
      if (calc.archivedAt)
        return problem(res, 409, "Conflict", "Cannot save an archived calculation");
      // Approved calcs are locked — saves get rejected.
      if (calc.status === "approved") {
        return problem(
          res,
          409,
          "Conflict",
          "Calculation is approved and locked. Roll back first if you need to edit.",
        );
      }

      const newVersion = calc.version + 1;
      const [version] = await deps.db
        .insert(calculationVersions)
        .values({
          calculationId: id,
          version: newVersion,
          inputsJson: parsed.data.inputs,
          outputsJson: parsed.data.outputs ?? {},
          rowAnnotations: parsed.data.rowAnnotations ?? {},
          notes: parsed.data.notes ?? null,
          computedAt: new Date(),
          computedBy: req.user.id,
        })
        .returning();
      if (!version) return problem(res, 500, "Internal error", "Insert returned no row");

      const [updated] = await deps.db
        .update(calculations)
        .set({
          version: newVersion,
          currentVersionId: version.id,
          inputsJson: parsed.data.inputs,
          outputsJson: parsed.data.outputs ?? {},
          computedAt: new Date(),
          computedBy: req.user.id,
          updatedAt: new Date(),
        })
        .where(eq(calculations.id, id))
        .returning();

      await recordAuditEvent(deps.db, {
        action: "calculation.save",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
        payload: { version: newVersion, versionId: version.id },
      });

      res.json({ calculation: updated, version });
    },
  );

  router.get(
    "/versions",
    requirePermission("calculation:read"),
    async (req: Request, res: Response) => {
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const rows = await deps.db
        .select()
        .from(calculationVersions)
        .where(eq(calculationVersions.calculationId, id))
        .orderBy(desc(calculationVersions.version));
      res.json({ versions: rows });
    },
  );

  router.get(
    "/versions/:vid",
    requirePermission("calculation:read"),
    async (req: Request, res: Response) => {
      const id = readId(req);
      const vid = readVidParam(req);
      if (!id || !vid) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .select()
        .from(calculationVersions)
        .where(and(eq(calculationVersions.calculationId, id), eq(calculationVersions.id, vid)))
        .limit(1);
      if (!row) return problem(res, 404, "Not found", "Version not found");
      res.json({ version: row });
    },
  );

  router.get(
    "/diff",
    requirePermission("calculation:read"),
    async (req: Request, res: Response) => {
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const a = typeof req.query.a === "string" ? req.query.a : "";
      const b = typeof req.query.b === "string" ? req.query.b : "";
      if (!a || !b) return problem(res, 400, "Bad request", "Pass ?a=&b= version ids");
      const rows = await deps.db
        .select()
        .from(calculationVersions)
        .where(eq(calculationVersions.calculationId, id))
        .orderBy(asc(calculationVersions.version));
      const va = rows.find((r) => r.id === a);
      const vb = rows.find((r) => r.id === b);
      if (!va || !vb) return problem(res, 404, "Not found", "One or both versions not found");
      res.json({ a: va, b: vb, diff: shallowDiff(va.inputsJson, vb.inputsJson) });
    },
  );

  router.post(
    "/rollback",
    requirePermission("calculation:update"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = rollbackSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const [calc] = await deps.db
        .select()
        .from(calculations)
        .where(eq(calculations.id, id))
        .limit(1);
      if (!calc) return problem(res, 404, "Not found", "Calculation not found");
      const [target] = await deps.db
        .select()
        .from(calculationVersions)
        .where(
          and(
            eq(calculationVersions.calculationId, id),
            eq(calculationVersions.id, parsed.data.versionId),
          ),
        )
        .limit(1);
      if (!target) return problem(res, 404, "Not found", "Target version not found");

      const newVersion = calc.version + 1;
      const [version] = await deps.db
        .insert(calculationVersions)
        .values({
          calculationId: id,
          version: newVersion,
          inputsJson: target.inputsJson,
          outputsJson: target.outputsJson,
          rowAnnotations: target.rowAnnotations,
          notes: parsed.data.notes ?? `Rolled back from v${target.version}`,
          computedAt: new Date(),
          computedBy: req.user.id,
        })
        .returning();
      if (!version) return problem(res, 500, "Internal error", "Insert returned no row");

      const [updated] = await deps.db
        .update(calculations)
        .set({
          version: newVersion,
          currentVersionId: version.id,
          inputsJson: target.inputsJson,
          outputsJson: target.outputsJson,
          status: "draft",
          updatedAt: new Date(),
        })
        .where(eq(calculations.id, id))
        .returning();

      await recordAuditEvent(deps.db, {
        action: "calculation.rollback",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
        payload: { fromVersionId: target.id, fromVersion: target.version, newVersion },
      });

      res.json({ calculation: updated, version });
    },
  );

  router.post(
    "/submit-for-review",
    requirePermission("calculation:submit-for-review"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [updated] = await deps.db
        .update(calculations)
        .set({ status: "ready_for_review", updatedAt: new Date() })
        .where(and(eq(calculations.id, id), eq(calculations.status, "draft")))
        .returning();
      if (!updated) {
        return problem(res, 409, "Conflict", "Calculation is not in 'draft' status");
      }
      await recordAuditEvent(deps.db, {
        action: "calculation.submit_for_review",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
      });
      res.json({ calculation: updated });
    },
  );

  router.post(
    "/approve",
    requirePermission("calculation:approve"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [calc] = await deps.db
        .select()
        .from(calculations)
        .where(eq(calculations.id, id))
        .limit(1);
      if (!calc) return problem(res, 404, "Not found", "Calculation not found");
      if (calc.status !== "ready_for_review") {
        return problem(res, 409, "Conflict", "Calculation is not awaiting review");
      }

      // Lock the current version.
      if (calc.currentVersionId) {
        await deps.db
          .update(calculationVersions)
          .set({ lockedAt: new Date(), lockedBy: req.user.id })
          .where(eq(calculationVersions.id, calc.currentVersionId));
      }

      const [updated] = await deps.db
        .update(calculations)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(calculations.id, id))
        .returning();
      await recordAuditEvent(deps.db, {
        action: "calculation.approve",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
        payload: { versionId: calc.currentVersionId },
      });
      res.json({ calculation: updated });
    },
  );

  router.post(
    "/reject",
    requirePermission("calculation:reject"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = rejectSchema.safeParse(req.body);
      const [updated] = await deps.db
        .update(calculations)
        .set({ status: "draft", updatedAt: new Date() })
        .where(and(eq(calculations.id, id), eq(calculations.status, "ready_for_review")))
        .returning();
      if (!updated) {
        return problem(res, 409, "Conflict", "Calculation is not awaiting review");
      }
      const reason = parsed.success ? parsed.data.reason : undefined;
      await recordAuditEvent(deps.db, {
        action: "calculation.reject",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
        payload: reason ? { reason } : {},
      });
      if (reason) {
        await deps.db.insert(calculationComments).values({
          calculationId: id,
          authorId: req.user.id,
          body: reason,
          kind: "review_response",
        });
      }
      res.json({ calculation: updated });
    },
  );

  router.get(
    "/comments",
    requirePermission("calculation:read"),
    async (req: Request, res: Response) => {
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const rows = await deps.db
        .select()
        .from(calculationComments)
        .where(eq(calculationComments.calculationId, id))
        .orderBy(asc(calculationComments.createdAt));
      res.json({ comments: rows });
    },
  );

  router.post(
    "/comments",
    requirePermission("calculation:read"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const parsed = commentSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const [row] = await deps.db
        .insert(calculationComments)
        .values({
          calculationId: id,
          versionId: parsed.data.versionId ?? null,
          authorId: req.user.id,
          body: parsed.data.body,
          kind: parsed.data.kind,
        })
        .returning();
      await recordAuditEvent(deps.db, {
        action: "calculation.comment",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
        payload: { commentId: row?.id, kind: parsed.data.kind },
      });
      res.status(201).json({ comment: row });
    },
  );

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function readVidParam(req: Request): string {
  return typeof req.params.vid === "string" ? req.params.vid : "";
}

interface DiffEntry {
  key: string;
  before: unknown;
  after: unknown;
}

function shallowDiff(a: Record<string, unknown>, b: Record<string, unknown>): DiffEntry[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const diff: DiffEntry[] = [];
  for (const key of keys) {
    const before = a?.[key];
    const after = b?.[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff.push({ key, before: before ?? null, after: after ?? null });
    }
  }
  return diff;
}
