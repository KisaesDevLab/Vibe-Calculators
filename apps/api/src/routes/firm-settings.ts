import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { firmSettings, FIRM_SETTINGS_ID, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 25.4 / 13.3 — firm-wide settings.
 *
 *   GET /api/v1/admin/firm-settings        view
 *   PUT /api/v1/admin/firm-settings        update (admin only)
 *
 * The row is a singleton (id = 'singleton'). The migration seeds
 * the row with empty values so the GET always returns 200.
 *
 * Logo data-URLs are size-capped at 1 MB application-side
 * (uploads beyond that should go through a future asset endpoint
 * rather than ride the row).
 */

export interface FirmSettingsRouteDeps {
  db: Database;
}

const MAX_LOGO_BYTES = 1_048_576;

const updateSchema = z.object({
  firmName: z.string().max(200).optional(),
  firmEin: z
    .string()
    .max(20)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  firmAddress: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  firmPhone: z
    .string()
    .max(50)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  pdfFooter: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  logoDataUrl: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v))
    .refine(
      (v) =>
        v === null ||
        v === undefined ||
        (v.startsWith("data:image/") && v.length <= MAX_LOGO_BYTES * 1.4),
      "logoDataUrl must be a data:image/* URL ≤ 1 MB",
    ),
  timezone: z.string().max(100).optional(),
});

export function buildFirmSettingsRouter(deps: FirmSettingsRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), async (_req: Request, res: Response) => {
    const [row] = await deps.db
      .select()
      .from(firmSettings)
      .where(eq(firmSettings.id, FIRM_SETTINGS_ID))
      .limit(1);
    if (!row) {
      return problem(res, 500, "Internal", "firm_settings singleton missing — re-run migrations");
    }
    res.json({ firmSettings: row });
  });

  router.put("/", requirePermission("user:invite"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    // Build the partial update — drop undefineds so each field is
    // independently editable. Empty string → null is handled by the
    // schema's transforms above.
    const patch: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)),
      updatedAt: new Date(),
      updatedBy: req.user.id,
    };

    const [row] = await deps.db
      .update(firmSettings)
      .set(patch)
      .where(eq(firmSettings.id, FIRM_SETTINGS_ID))
      .returning();
    if (!row) return problem(res, 500, "Internal", "Update returned no row");

    await recordAuditEvent(deps.db, {
      action: "client.update",
      entityKind: "client",
      entityId: FIRM_SETTINGS_ID,
      actorUserId: req.user.id,
      payload: {
        fields: Object.keys(parsed.data).filter(
          (k) => parsed.data[k as keyof typeof parsed.data] !== undefined,
        ),
      },
    });

    res.json({ firmSettings: row });
  });

  return router;
}
