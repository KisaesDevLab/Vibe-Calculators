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

/**
 * Reject SVG logos: SVG can carry &lt;script&gt; / foreignObject / xlink
 * payloads that would execute when the logo is re-emitted in any
 * HTML or PDF that supports scripted content. PNG / JPEG / WebP are
 * the only formats the renderer needs, and all three carry magic-byte
 * signatures we verify after base64-decode.
 */
function isAllowedLogoDataUrl(value: string): boolean {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!m) return false;
  // 1.4× cap on the data URL string ≈ 1 MB raw payload.
  if (value.length > MAX_LOGO_BYTES * 1.4) return false;
  let buf: Buffer;
  try {
    buf = Buffer.from(m[2] ?? "", "base64");
  } catch {
    return false;
  }
  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return true;
  return false;
}

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
      (v) => v === null || v === undefined || isAllowedLogoDataUrl(v),
      "logoDataUrl must be data:image/(png|jpeg|webp) ≤ 1 MB; SVG is rejected to avoid script injection in PDFs",
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

  /**
   * Phase 4.1 — non-admin readable branding subset. Anyone with an
   * authenticated session can fetch the firm name / brand color /
   * logo so the AppShell topbar shows the firm identity without
   * leaking EIN, address, phone, footer to unprivileged users.
   */
  router.get("/public", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const [row] = await deps.db
      .select()
      .from(firmSettings)
      .where(eq(firmSettings.id, FIRM_SETTINGS_ID))
      .limit(1);
    if (!row) {
      res.json({ branding: { firmName: null, brandColor: null, logoDataUrl: null } });
      return;
    }
    res.json({
      branding: {
        firmName: row.firmName ?? null,
        brandColor: row.brandColor ?? null,
        logoDataUrl: row.logoDataUrl ?? null,
      },
    });
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
