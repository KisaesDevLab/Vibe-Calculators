import { Router, type Request, type Response } from "express";
import { and, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { tags, entityTags, type Database, type TaggedEntityKind } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 20.4 — tags + polymorphic entity_tags.
 *
 *   GET    /api/v1/tags?q=...                   list (autocomplete)
 *   POST   /api/v1/tags                         create new tag (preparer+)
 *   POST   /api/v1/tags/attach                  attach tag to entity
 *   POST   /api/v1/tags/detach                  detach tag from entity
 *   POST   /api/v1/tags/bulk-attach             attach one tag to N entities (preparer+)
 *
 * The "tagged entity" enum is centralized in packages/db; routes
 * accept any value the enum accepts.
 */

export interface TagsRouteDeps {
  db: Database;
}

const entityKindEnum = z.enum(["client", "engagement", "calculation"]);

const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u)
    .optional(),
});

const attachSchema = z.object({
  tagId: z.string().min(1).optional(),
  tagName: z.string().min(1).max(60).optional(),
  entityKind: entityKindEnum,
  entityId: z.string().min(1),
});

const bulkAttachSchema = z.object({
  tagId: z.string().min(1).optional(),
  tagName: z.string().min(1).max(60).optional(),
  entityKind: entityKindEnum,
  entityIds: z.array(z.string().min(1)).min(1).max(200),
});

const detachSchema = z.object({
  tagId: z.string().min(1),
  entityKind: entityKindEnum,
  entityId: z.string().min(1),
});

export function buildTagsRouter(deps: TagsRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("client:read"), async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rows =
      q.length > 0
        ? await deps.db
            .select()
            .from(tags)
            .where(ilike(tags.name, `${q}%`))
            .limit(25)
        : await deps.db.select().from(tags).orderBy(tags.name).limit(100);
    // Counts per tag (rough — single query with group-by).
    const counts = await deps.db
      .select({ tagId: entityTags.tagId, count: sql<number>`count(*)::int` })
      .from(entityTags)
      .groupBy(entityTags.tagId);
    const countMap = new Map(counts.map((c) => [c.tagId, Number(c.count)]));
    res.json({
      tags: rows.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        usageCount: countMap.get(t.id) ?? 0,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  });

  router.post("/", requirePermission("client:update"), async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
    const existing = await deps.db
      .select()
      .from(tags)
      .where(eq(tags.name, parsed.data.name))
      .limit(1);
    const found = existing[0];
    if (found)
      return res.status(200).json({ tag: { id: found.id, name: found.name, color: found.color } });
    const [row] = await deps.db
      .insert(tags)
      .values({ name: parsed.data.name, color: parsed.data.color ?? null })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({ tag: { id: row.id, name: row.name, color: row.color } });
  });

  router.post(
    "/attach",
    requirePermission("client:update"),
    async (req: Request, res: Response) => {
      const parsed = attachSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const tagId = await resolveTagId(deps.db, parsed.data);
      if (!tagId) return problem(res, 400, "Bad request", "Provide tagId or tagName");
      await deps.db
        .insert(entityTags)
        .values({
          tagId,
          entityKind: parsed.data.entityKind as TaggedEntityKind,
          entityId: parsed.data.entityId,
        })
        .onConflictDoNothing();
      res.status(204).end();
    },
  );

  router.post(
    "/bulk-attach",
    requirePermission("client:update"),
    async (req: Request, res: Response) => {
      const parsed = bulkAttachSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const tagId = await resolveTagId(deps.db, parsed.data);
      if (!tagId) return problem(res, 400, "Bad request", "Provide tagId or tagName");
      const rows = parsed.data.entityIds.map((entityId) => ({
        tagId,
        entityKind: parsed.data.entityKind as TaggedEntityKind,
        entityId,
      }));
      await deps.db.insert(entityTags).values(rows).onConflictDoNothing();
      res.json({ attached: rows.length, tagId });
    },
  );

  router.post(
    "/detach",
    requirePermission("client:update"),
    async (req: Request, res: Response) => {
      const parsed = detachSchema.safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      await deps.db
        .delete(entityTags)
        .where(
          and(
            eq(entityTags.tagId, parsed.data.tagId),
            eq(entityTags.entityKind, parsed.data.entityKind as TaggedEntityKind),
            eq(entityTags.entityId, parsed.data.entityId),
          ),
        );
      res.status(204).end();
    },
  );

  return router;
}

async function resolveTagId(
  db: Database,
  input: { tagId?: string | undefined; tagName?: string | undefined },
): Promise<string | null> {
  if (input.tagId) return input.tagId;
  if (!input.tagName) return null;
  const existing = await db.select().from(tags).where(eq(tags.name, input.tagName)).limit(1);
  const found = existing[0];
  if (found) return found.id;
  const [created] = await db.insert(tags).values({ name: input.tagName }).returning();
  return created?.id ?? null;
}
