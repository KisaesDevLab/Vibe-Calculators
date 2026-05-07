import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { emailProviderSettings, EMAIL_PROVIDER_SETTINGS_ID, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import {
  getEmailProviderSettings,
  resolveEmailProvider,
  readEmailEnv,
} from "../lib/email-provider-resolver.js";
import type { KmsClient } from "../lib/kms.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Admin email provider config + status + test send.
 *
 *   GET  /api/v1/admin/email/settings  — current DB config (secrets redacted)
 *   PUT  /api/v1/admin/email/settings  — update DB config (seals secrets)
 *   POST /api/v1/admin/email/test      — fire a probe email to a given address
 *
 * DB takes precedence over .env once activeProvider is set; .env stays
 * as a fallback for fresh installs. Secrets (SMTP password, Postmark
 * token, EmailIt key) are sealed via KmsClient before storage; only a
 * 4-char prefix is surfaced back to the UI.
 */

export interface AdminEmailRouteDeps {
  db?: Database;
  kms?: KmsClient | undefined;
}

const settingsSchema = z.object({
  activeProvider: z.enum(["smtp", "postmark", "emailit"]).nullable(),
  // SMTP
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65_535).nullable().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  /** Empty string = leave existing pass alone. */
  smtpPass: z.string().max(500).optional(),
  clearSmtpPass: z.boolean().optional(),
  smtpSecure: z.boolean().optional(),
  smtpFrom: z.string().max(255).nullable().optional(),
  // Postmark
  postmarkToken: z.string().max(500).optional(),
  clearPostmarkToken: z.boolean().optional(),
  postmarkFrom: z.string().max(255).nullable().optional(),
  postmarkStream: z.string().max(100).nullable().optional(),
  // EmailIt
  emailitKey: z.string().max(500).optional(),
  clearEmailitKey: z.boolean().optional(),
  emailitFrom: z.string().max(255).nullable().optional(),
  emailitEndpoint: z.string().max(500).nullable().optional(),
});

const testSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).default("Vibe Calculators — test email"),
  body: z
    .string()
    .min(1)
    .max(2000)
    .default("This is a test email from Vibe Calculators. If you can read it, delivery works."),
});

export function buildAdminEmailRouter(deps: AdminEmailRouteDeps): Router {
  const router = Router();

  router.get(
    "/settings",
    requirePermission("settings:write"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      if (!deps.db || !deps.kms) {
        return problem(res, 503, "Service unavailable", "DB or KMS not configured");
      }
      const settings = await getEmailProviderSettings(deps.db);
      const env = readEmailEnv();
      res.json({
        settings: {
          activeProvider: settings.activeProvider,
          smtpHost: settings.smtpHost,
          smtpPort: settings.smtpPort,
          smtpUser: settings.smtpUser,
          smtpPassPrefix: settings.smtpPassSealed
            ? maskedPrefix(deps.kms, settings.smtpPassSealed)
            : null,
          smtpSecure: settings.smtpSecure,
          smtpFrom: settings.smtpFrom,
          postmarkTokenPrefix: settings.postmarkTokenSealed
            ? maskedPrefix(deps.kms, settings.postmarkTokenSealed)
            : null,
          postmarkFrom: settings.postmarkFrom,
          postmarkStream: settings.postmarkStream,
          emailitKeyPrefix: settings.emailitKeySealed
            ? maskedPrefix(deps.kms, settings.emailitKeySealed)
            : null,
          emailitFrom: settings.emailitFrom,
          emailitEndpoint: settings.emailitEndpoint,
          updatedAt: settings.updatedAt.toISOString(),
        },
        envFallback: {
          provider: env.VIBE_EMAIL_PROVIDER ?? null,
          smtpHostSet: Boolean(env.SMTP_HOST),
          smtpPassSet: Boolean(env.SMTP_PASS),
          postmarkTokenSet: Boolean(env.POSTMARK_SERVER_TOKEN),
          emailitKeySet: Boolean(env.EMAILIT_API_KEY),
        },
      });
    },
  );

  router.put(
    "/settings",
    requirePermission("settings:write"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      if (!deps.db || !deps.kms) {
        return problem(res, 503, "Service unavailable", "DB or KMS not configured");
      }
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return problem(res, 400, "Bad request", "Invalid body", {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      const body = parsed.data;
      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedBy: req.user.id,
      };
      if (body.activeProvider !== undefined) patch.activeProvider = body.activeProvider;
      // SMTP
      if (body.smtpHost !== undefined) patch.smtpHost = body.smtpHost || null;
      if (body.smtpPort !== undefined) patch.smtpPort = body.smtpPort;
      if (body.smtpUser !== undefined) patch.smtpUser = body.smtpUser || null;
      if (body.smtpSecure !== undefined) patch.smtpSecure = body.smtpSecure;
      if (body.smtpFrom !== undefined) patch.smtpFrom = body.smtpFrom || null;
      if (body.clearSmtpPass === true) {
        patch.smtpPassSealed = null;
      } else if (body.smtpPass && body.smtpPass.length > 0) {
        patch.smtpPassSealed = deps.kms.encrypt(body.smtpPass);
      }
      // Postmark
      if (body.postmarkFrom !== undefined) patch.postmarkFrom = body.postmarkFrom || null;
      if (body.postmarkStream !== undefined) patch.postmarkStream = body.postmarkStream || null;
      if (body.clearPostmarkToken === true) {
        patch.postmarkTokenSealed = null;
      } else if (body.postmarkToken && body.postmarkToken.length > 0) {
        patch.postmarkTokenSealed = deps.kms.encrypt(body.postmarkToken);
      }
      // EmailIt
      if (body.emailitFrom !== undefined) patch.emailitFrom = body.emailitFrom || null;
      if (body.emailitEndpoint !== undefined) patch.emailitEndpoint = body.emailitEndpoint || null;
      if (body.clearEmailitKey === true) {
        patch.emailitKeySealed = null;
      } else if (body.emailitKey && body.emailitKey.length > 0) {
        patch.emailitKeySealed = deps.kms.encrypt(body.emailitKey);
      }

      // Ensure the singleton row exists. The migration seeds it, but
      // TRUNCATE CASCADE through the updated_by FK can wipe it (e.g.
      // in test fixtures), so we lazy-create defensively before update.
      await getEmailProviderSettings(deps.db);
      await deps.db
        .update(emailProviderSettings)
        .set(patch)
        .where(eq(emailProviderSettings.id, EMAIL_PROVIDER_SETTINGS_ID));

      // Audit which fields changed (never the values).
      await recordAuditEvent(deps.db, {
        action: "client.update",
        entityKind: "client",
        entityId: EMAIL_PROVIDER_SETTINGS_ID,
        actorUserId: req.user.id,
        payload: {
          fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
          target: "email_provider_settings",
        },
      });

      res.status(204).end();
    },
  );

  router.post("/test", requirePermission("settings:write"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    if (!deps.db || !deps.kms) {
      return problem(res, 503, "Service unavailable", "DB or KMS not configured");
    }
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const resolved = await resolveEmailProvider(deps.db, deps.kms, readEmailEnv());
    if (!resolved) {
      return problem(
        res,
        503,
        "Service unavailable",
        "No email provider configured. Pick a provider and fill its credentials, or set VIBE_EMAIL_PROVIDER + matching env vars.",
      );
    }
    const start = Date.now();
    try {
      const out = await resolved.provider.send({
        to: parsed.data.to,
        subject: parsed.data.subject,
        text: parsed.data.body,
      });
      res.json({
        ok: true,
        provider: resolved.providerName,
        source: resolved.source,
        messageId: out.messageId,
        elapsedMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return problem(res, 502, "Email delivery failed", message);
    }
  });

  return router;
}

function maskedPrefix(kms: KmsClient, sealed: string): string | null {
  try {
    const plain = kms.decrypt(sealed);
    return plain.length >= 4 ? `${plain.slice(0, 4)}…` : "…";
  } catch {
    return "(unsealable — KMS key may have rotated)";
  }
}
