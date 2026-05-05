import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { webhookSubscriptions, type Database } from "@vibe-calc/db";
import type { KmsClient } from "../lib/kms.js";
import { problem, requirePermission } from "../middleware/auth.js";

/**
 * Phase 24.3 — webhook subscriptions.
 *
 *   GET    /api/v1/webhooks
 *   POST   /api/v1/webhooks    create (admin)
 *   DELETE /api/v1/webhooks/:id  archive
 *
 * Outbound delivery is handled by lib/webhook-dispatch.ts; the
 * dispatcher reads from this table and signs each request.
 */

export interface WebhooksRouteDeps {
  db: Database;
  /**
   * KMS client for sealing webhook signing secrets at rest. Webhook
   * secrets are HMAC keys for signing outbound payloads — leaking
   * them would let an attacker forge events into downstream systems.
   * Sealed at issuance; unsealed at dispatch time.
   */
  kms: KmsClient;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z
    .string()
    .url()
    .refine((u) => isSafeWebhookUrl(u), {
      message:
        "URL must be https (http only for explicit test hostnames) and must NOT target private IP / loopback / link-local / cloud-metadata addresses",
    }),
  actions: z.array(z.string()).default([]),
});

/**
 * SSRF guard. Webhook URLs go to untrusted destinations; if an admin
 * (or compromised admin token) sets the URL to an internal address,
 * the dispatcher would happily POST every event there. Block:
 *   - non-https schemes (http permitted only for explicit test hosts)
 *   - hostname `localhost` / IPv6 loopback / cloud-metadata names
 *   - private IPv4 ranges (10/8, 127/8, 169.254/16, 172.16/12, 192.168/16)
 *   - obvious IPv6 link-local (fe80::), unique-local (fc/fd::), loopback
 * Hostname-to-IP DNS isn't done here; downstream `fetch` follows
 * redirects automatically — a future hardening would refuse redirects
 * to a different host.
 */
function isSafeWebhookUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === "http:") {
    const allowedHttp = new Set(["example.test", "webhook.local", "localhost.test"]);
    if (!allowedHttp.has(host)) return false;
  }
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") return false;
  if (host === "169.254.169.254") return false; // AWS / GCP metadata
  if (host === "metadata.google.internal") return false;

  // Refuse encoded IPv4 forms — `0177.0.0.1` (octal), `0x7f.0.0.1`
  // (hex), `2130706433` (integer 127.0.0.1). Rather than parse each
  // form, reject any host whose first character is `0` followed by
  // digits, hex, or `x` — these are not legitimate hostnames and
  // disallowing them prevents bypass attempts. Also reject pure-
  // numeric hosts (integer-form IPs).
  if (/^0[0-7]+(\.|$)/.test(host)) return false; // octal IPv4
  if (/^0x[0-9a-f]+(\.|$)/.test(host)) return false; // hex IPv4
  if (/^\d+$/.test(host)) return false; // integer-form IPv4

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
  }
  if (host.startsWith("[") || host.includes(":")) {
    if (host.includes("::1")) return false;
    if (host.startsWith("fe80")) return false;
    if (host.startsWith("fc") || host.startsWith("fd")) return false;
  }
  return true;
}

export function buildWebhooksRouter(deps: WebhooksRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("user:list"), async (_req: Request, res: Response) => {
    const rows = await deps.db
      .select({
        id: webhookSubscriptions.id,
        name: webhookSubscriptions.name,
        url: webhookSubscriptions.url,
        actions: webhookSubscriptions.actions,
        createdAt: webhookSubscriptions.createdAt,
        lastFiredAt: webhookSubscriptions.lastFiredAt,
        lastFailureMessage: webhookSubscriptions.lastFailureMessage,
        archivedAt: webhookSubscriptions.archivedAt,
      })
      .from(webhookSubscriptions)
      .where(isNull(webhookSubscriptions.archivedAt))
      .orderBy(desc(webhookSubscriptions.createdAt))
      .limit(200);
    res.json({ webhooks: rows });
  });

  router.post("/", requirePermission("user:invite"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    // Seal at rest. The dispatcher unseals just before signing each
    // outbound payload; a DB read alone cannot forge events into the
    // downstream consumer.
    const sealedSecret = deps.kms.encrypt(secret);
    const [row] = await deps.db
      .insert(webhookSubscriptions)
      .values({
        name: parsed.data.name,
        url: parsed.data.url,
        actions: parsed.data.actions,
        secret: sealedSecret,
        createdBy: req.user.id,
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({
      webhook: {
        id: row.id,
        name: row.name,
        url: row.url,
        actions: row.actions,
        createdAt: row.createdAt.toISOString(),
      },
      secret,
      warning: "Copy the signing secret now — it cannot be retrieved later.",
    });
  });

  router.delete("/:id", requirePermission("user:invite"), async (req: Request, res: Response) => {
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [row] = await deps.db
      .update(webhookSubscriptions)
      .set({ archivedAt: new Date() })
      .where(and(eq(webhookSubscriptions.id, id), isNull(webhookSubscriptions.archivedAt)))
      .returning();
    if (!row) return problem(res, 404, "Not found", "Webhook not found or already archived");
    res.status(204).end();
  });

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}
