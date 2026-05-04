import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull, or, ilike, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  clients,
  engagements,
  calculations,
  entityTags,
  tags,
  type ClientAddress,
  type ClientContact,
  type Database,
} from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 20.1 + 20.2 — clients CRUD.
 *
 * Endpoints:
 *   GET    /api/v1/clients                  list (search/filter/sort)
 *   POST   /api/v1/clients                  create (preparer+)
 *   GET    /api/v1/clients/:id              detail with engagements + calcs + tags
 *   PATCH  /api/v1/clients/:id              update (preparer+)
 *   POST   /api/v1/clients/:id/archive      soft-archive (preparer+)
 *   POST   /api/v1/clients/:id/restore      un-archive (preparer+)
 */

export interface ClientRouteDeps {
  db: Database;
}

const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

const contactSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
});

const entityTypeEnum = z.enum([
  "individual",
  "sole_prop",
  "single_member_llc",
  "multi_member_llc",
  "s_corp",
  "c_corp",
  "partnership",
  "trust",
  "estate",
  "nonprofit",
  "other",
]);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  entityType: entityTypeEnum,
  ein: z
    .string()
    .regex(/^\d{2}-\d{7}$/u, "EIN must be ##-#######")
    .optional(),
  address: addressSchema.optional(),
  primaryContact: contactSchema.optional(),
});

const updateSchema = createSchema.partial();

const listQuery = z.object({
  q: z.string().trim().optional(),
  entityType: entityTypeEnum.optional(),
  includeArchived: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  sort: z.enum(["name", "created", "updated"]).default("name"),
  limit: z
    .string()
    .regex(/^\d+$/u)
    .transform((s) => Math.min(500, Math.max(1, Number(s))))
    .optional(),
});

export function buildClientsRouter(deps: ClientRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("client:read"), async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid query");
    const { q, entityType, includeArchived, sort, limit } = parsed.data;
    const conditions = [];
    if (!includeArchived) conditions.push(isNull(clients.archivedAt));
    if (entityType) conditions.push(eq(clients.entityType, entityType));
    if (q && q.length > 0) {
      conditions.push(or(ilike(clients.name, `%${q}%`), ilike(clients.ein, `%${q}%`))!);
    }
    const orderCol =
      sort === "created"
        ? clients.createdAt
        : sort === "updated"
          ? clients.updatedAt
          : clients.name;
    const rows = await deps.db
      .select()
      .from(clients)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sort === "name" ? clients.name : desc(orderCol))
      .limit(limit ?? 100);
    res.json({ clients: rows.map(serializeClient) });
  });

  router.post("/", requirePermission("client:create"), async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const userId = req.user?.id ?? null;
    const [row] = await deps.db
      .insert(clients)
      .values({
        name: parsed.data.name,
        entityType: parsed.data.entityType,
        ein: parsed.data.ein ?? null,
        addressJson: (parsed.data.address ?? {}) as ClientAddress,
        primaryContactJson: (parsed.data.primaryContact ?? {}) as ClientContact,
        createdBy: userId,
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({ client: serializeClient(row) });
  });

  router.get("/:id", requirePermission("client:read"), async (req: Request, res: Response) => {
    const id = readIdParam(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [client] = await deps.db.select().from(clients).where(eq(clients.id, id)).limit(1);
    if (!client) return problem(res, 404, "Not found", "Client not found");
    const eng = await deps.db
      .select()
      .from(engagements)
      .where(and(eq(engagements.clientId, id), isNull(engagements.archivedAt)))
      .orderBy(desc(engagements.taxYear), desc(engagements.createdAt));
    const calcs = await deps.db
      .select()
      .from(calculations)
      .where(and(eq(calculations.clientId, id), isNull(calculations.archivedAt)))
      .orderBy(desc(calculations.updatedAt))
      .limit(50);
    const tagRows = await deps.db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(entityTags)
      .innerJoin(tags, eq(entityTags.tagId, tags.id))
      .where(and(eq(entityTags.entityKind, "client"), eq(entityTags.entityId, id)));
    res.json({
      client: serializeClient(client),
      engagements: eng.map(serializeEngagement),
      recentCalculations: calcs.map(serializeCalculation),
      tags: tagRows,
    });
  });

  router.patch("/:id", requirePermission("client:update"), async (req: Request, res: Response) => {
    const id = readIdParam(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.entityType !== undefined) patch.entityType = parsed.data.entityType;
    if (parsed.data.ein !== undefined) patch.ein = parsed.data.ein;
    if (parsed.data.address !== undefined) patch.addressJson = parsed.data.address as ClientAddress;
    if (parsed.data.primaryContact !== undefined) {
      patch.primaryContactJson = parsed.data.primaryContact as ClientContact;
    }
    const [row] = await deps.db.update(clients).set(patch).where(eq(clients.id, id)).returning();
    if (!row) return problem(res, 404, "Not found", "Client not found");
    res.json({ client: serializeClient(row) });
  });

  router.post(
    "/:id/archive",
    requirePermission("client:archive"),
    async (req: Request, res: Response) => {
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(clients)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(clients.id, id), isNull(clients.archivedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Client not found or already archived");
      res.json({ client: serializeClient(row) });
    },
  );

  router.post(
    "/:id/restore",
    requirePermission("client:archive"),
    async (req: Request, res: Response) => {
      const id = readIdParam(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(clients)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(clients.id, id), isNotNull(clients.archivedAt)))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Client not found or not archived");
      res.json({ client: serializeClient(row) });
    },
  );

  return router;
}

function readIdParam(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function serializeClient(c: typeof clients.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    entityType: c.entityType,
    ein: c.ein,
    address: c.addressJson,
    primaryContact: c.primaryContactJson,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
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
