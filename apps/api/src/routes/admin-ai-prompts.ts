import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiPrompts, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 23.17 — admin route for versioned prompts.
 *
 *   GET    /api/v1/admin/ai-prompts            list (filterable by kind)
 *   POST   /api/v1/admin/ai-prompts            create new version (kind + body)
 *   POST   /api/v1/admin/ai-prompts/:id/activate
 *                                              flip active=true on this row,
 *                                              active=false on every other
 *                                              row of the same kind
 *   POST   /api/v1/admin/ai-prompts/:id/archive
 *                                              soft-delete (sets archived_at)
 *
 * Read-public to anyone with user:list; mutations require user:invite.
 */

export interface AdminAiPromptsRouteDeps {
  db: Database;
}

const createSchema = z.object({
  kind: z.string().min(1).max(60),
  body: z.string().min(10).max(20_000),
  systemMessage: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
});

export function buildAdminAiPromptsRouter(deps: AdminAiPromptsRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), async (req: Request, res: Response) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const rows = await deps.db
      .select()
      .from(aiPrompts)
      .where(kind ? eq(aiPrompts.kind, kind) : undefined)
      .orderBy(desc(aiPrompts.kind), desc(aiPrompts.version));
    res.json({ prompts: rows });
  });

  router.post("/", requirePermission("user:invite"), async (req: Request, res: Response) => {
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
    // Compute the next version for this kind. The (kind, version) pair
    // is unique-by-construction; we never delete, only archive.
    const existing = await deps.db
      .select({ version: aiPrompts.version })
      .from(aiPrompts)
      .where(eq(aiPrompts.kind, parsed.data.kind))
      .orderBy(desc(aiPrompts.version))
      .limit(1);
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    const [row] = await deps.db
      .insert(aiPrompts)
      .values({
        kind: parsed.data.kind,
        version: nextVersion,
        body: parsed.data.body,
        systemMessage: parsed.data.systemMessage ?? null,
        notes: parsed.data.notes ?? null,
        active: false,
        createdBy: req.user.id,
      })
      .returning();
    res.status(201).json({ prompt: row });
  });

  router.post(
    "/:id/activate",
    requirePermission("user:invite"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = String(req.params.id ?? "");
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [target] = await deps.db.select().from(aiPrompts).where(eq(aiPrompts.id, id)).limit(1);
      if (!target) return problem(res, 404, "Not found", "Prompt not found");
      if (target.archivedAt) {
        return problem(res, 409, "Conflict", "Cannot activate an archived prompt");
      }
      await deps.db.transaction(async (tx) => {
        // Atomically deactivate every prompt of this kind, then activate the target.
        await tx.update(aiPrompts).set({ active: false }).where(eq(aiPrompts.kind, target.kind));
        await tx.update(aiPrompts).set({ active: true }).where(eq(aiPrompts.id, id));
      });
      res.json({ ok: true, kind: target.kind, version: target.version });
    },
  );

  router.post(
    "/:id/archive",
    requirePermission("user:invite"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = String(req.params.id ?? "");
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [updated] = await deps.db
        .update(aiPrompts)
        .set({ archivedAt: new Date(), active: false })
        .where(and(eq(aiPrompts.id, id), eq(aiPrompts.active, true)))
        .returning();
      if (!updated) {
        // The id wasn't active; archive directly without the active=true filter.
        const [row] = await deps.db
          .update(aiPrompts)
          .set({ archivedAt: new Date() })
          .where(eq(aiPrompts.id, id))
          .returning();
        if (!row) return problem(res, 404, "Not found", "Prompt not found");
        return res.json({ prompt: row });
      }
      res.json({ prompt: updated });
    },
  );

  return router;
}
