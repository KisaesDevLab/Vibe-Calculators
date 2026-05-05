import { createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { webhookSubscriptions, type Database } from "@vibe-calc/db";

/**
 * Phase 24.3 — webhook dispatcher.
 *
 * Each subscription carries an action filter and an HMAC secret.
 * The dispatcher signs the body with `X-Vibe-Signature: t=<unix>,v1=<hex>`
 * (Stripe-style) so consumers can verify integrity.
 *
 * Production retries failed deliveries via BullMQ with exponential
 * backoff; the MVP fires once and records last_failure_message.
 */

export interface DispatchInput {
  action: string;
  entityKind: string;
  entityId: string;
  payload?: Record<string, unknown>;
  /** Override fetch for tests. */
  fetcher?: typeof fetch;
  /** Override clock. */
  now?: Date;
  /** Hard per-request timeout. Default 10s. */
  timeoutMs?: number;
}

export async function dispatchWebhook(
  db: Database,
  input: DispatchInput,
): Promise<{
  fired: number;
  successes: number;
  failures: number;
}> {
  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(isNull(webhookSubscriptions.archivedAt));

  let successes = 0;
  let failures = 0;
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? new Date();

  // The body is the same for every recipient; sign it once per sub.
  const body = JSON.stringify({
    action: input.action,
    entityKind: input.entityKind,
    entityId: input.entityId,
    payload: input.payload ?? {},
    timestamp: now.toISOString(),
  });

  const matching = subs.filter((s) => {
    if (!Array.isArray(s.actions) || s.actions.length === 0) return true;
    return s.actions.includes(input.action);
  });

  for (const sub of matching) {
    const t = Math.floor(now.getTime() / 1000);
    const sig = createHmac("sha256", sub.secret).update(`${t}.${body}`).digest("hex");
    // Per-call hard timeout — defense against a slow / malicious /
    // unreachable webhook target hanging the dispatcher loop.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 10_000);
    try {
      const res = await fetcher(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Vibe-Signature": `t=${t},v1=${sig}`,
          "X-Vibe-Action": input.action,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        failures++;
        await db
          .update(webhookSubscriptions)
          .set({ lastFailureMessage: `HTTP ${res.status}`, lastFiredAt: now })
          .where(and(eq(webhookSubscriptions.id, sub.id)));
        continue;
      }
      successes++;
      await db
        .update(webhookSubscriptions)
        .set({ lastFiredAt: now, lastFailureMessage: null })
        .where(eq(webhookSubscriptions.id, sub.id));
    } catch (err) {
      clearTimeout(timer);
      failures++;
      await db
        .update(webhookSubscriptions)
        .set({
          lastFailureMessage: err instanceof Error ? err.message : String(err),
          lastFiredAt: now,
        })
        .where(eq(webhookSubscriptions.id, sub.id));
    }
  }

  return { fired: matching.length, successes, failures };
}

/**
 * Verify an inbound webhook signature. Used by tests and any
 * consumer that wants to validate a payload they received.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | undefined,
  options: { toleranceSeconds?: number; now?: Date } = {},
): boolean {
  if (!signatureHeader) return false;
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(signatureHeader);
  if (!m) return false;
  const t = Number.parseInt(m[1]!, 10);
  const sig = m[2]!;
  const now = (options.now ?? new Date()).getTime() / 1000;
  if (Math.abs(now - t) > (options.toleranceSeconds ?? 300)) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return constantTimeEqual(expected, sig);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
