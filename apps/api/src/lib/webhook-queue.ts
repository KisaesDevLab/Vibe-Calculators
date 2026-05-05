import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { eq, and, lte, isNull } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  webhookDeliveries,
  webhookSubscriptions,
  type Database,
  type WebhookDeliveryRow,
} from "@vibe-calc/db";
import { logger } from "./logger.js";

/**
 * Phase 24.5 — webhook retry / dead-letter queue.
 *
 * Each (subscription, event) pair lands a row in `webhook_deliveries`
 * and a BullMQ job. The worker fetches the delivery row, attempts
 * delivery, and either marks `delivered` or schedules a retry. The
 * backoff ladder is exponential: 5 / 15 / 60 / 300 / 1800 seconds.
 * After 5 failed attempts the row is marked `dead`; a separate admin
 * UI can then redrive it.
 *
 * The worker runs in-process alongside the API + export workers
 * (each on its own BullMQ Queue/Worker pair). Concurrency 4 — webhook
 * dispatch is I/O-bound so it doesn't compete with PDF rendering.
 */

const QUEUE_NAME = "webhooks";
// 5 / 15 / 60 / 300 / 1800 — Stripe-like cap at 30 min, build-plan §24.5.
const BACKOFF_SECONDS = [5, 15, 60, 300, 1800];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

export interface WebhookQueueDeps {
  db: Database;
  redis: ConnectionOptions;
  /** Optional unseal hook for KMS-sealed `secret` columns. */
  unsealSecret?: (sealed: string) => string;
  /** Override fetch for tests. */
  fetcher?: typeof fetch;
}

interface WebhookJobPayload {
  deliveryId: string;
}

let queueInstance: Queue<WebhookJobPayload> | undefined;
let workerInstance: Worker<WebhookJobPayload> | undefined;

export function getWebhookQueue(deps: WebhookQueueDeps): Queue<WebhookJobPayload> {
  if (!queueInstance) {
    queueInstance = new Queue<WebhookJobPayload>(QUEUE_NAME, {
      connection: deps.redis,
      defaultJobOptions: {
        attempts: 1, // we manage retries via BullMQ delays per the ladder
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return queueInstance;
}

/**
 * Insert a `webhook_deliveries` row per matching subscription, then
 * enqueue one BullMQ job per row. The fired event is what the
 * production code paths call; retries are entirely owned by the
 * queue.
 */
export async function fireWebhookEvent(
  deps: WebhookQueueDeps,
  event: {
    action: string;
    entityKind: string;
    entityId: string;
    payload?: Record<string, unknown>;
  },
): Promise<{ enqueued: number }> {
  const subs = await deps.db
    .select()
    .from(webhookSubscriptions)
    .where(isNull(webhookSubscriptions.archivedAt));
  const matching = subs.filter(
    (s) => !Array.isArray(s.actions) || s.actions.length === 0 || s.actions.includes(event.action),
  );
  if (matching.length === 0) return { enqueued: 0 };

  const queue = getWebhookQueue(deps);
  let enqueued = 0;
  for (const sub of matching) {
    const [row] = await deps.db
      .insert(webhookDeliveries)
      .values({
        subscriptionId: sub.id,
        action: event.action,
        entityKind: event.entityKind,
        entityId: event.entityId,
        body: {
          action: event.action,
          entityKind: event.entityKind,
          entityId: event.entityId,
          payload: event.payload ?? {},
          timestamp: new Date().toISOString(),
        },
        status: "pending",
      })
      .returning();
    if (!row) continue;
    await queue.add(`webhook-${row.id}`, { deliveryId: row.id }, { jobId: row.id });
    enqueued++;
  }
  return { enqueued };
}

/**
 * Start the in-process webhook worker. Concurrency 4 — pure I/O.
 */
export function startWebhookWorker(deps: WebhookQueueDeps): Worker<WebhookJobPayload> {
  if (workerInstance) return workerInstance;
  workerInstance = new Worker<WebhookJobPayload>(
    QUEUE_NAME,
    async (job) => {
      await processDelivery(deps, job.data.deliveryId);
    },
    {
      connection: deps.redis,
      concurrency: Number(process.env.VIBE_WEBHOOK_CONCURRENCY ?? "4"),
    },
  );
  workerInstance.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, deliveryId: job?.data?.deliveryId, err: err.message },
      "webhook delivery worker error",
    );
  });
  return workerInstance;
}

export async function stopWebhookWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = undefined;
  }
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = undefined;
  }
}

// ---------------------------------------------------------------------
// Delivery processor
// ---------------------------------------------------------------------

async function processDelivery(deps: WebhookQueueDeps, deliveryId: string): Promise<void> {
  const [delivery] = await deps.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery) {
    logger.warn({ deliveryId }, "webhook delivery row missing — dropping");
    return;
  }
  if (delivery.status === "delivered" || delivery.status === "dead") return;

  const [sub] = await deps.db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, delivery.subscriptionId))
    .limit(1);
  if (!sub || sub.archivedAt !== null) {
    await deps.db
      .update(webhookDeliveries)
      .set({
        status: "dead",
        deadAt: new Date(),
        lastFailureMessage: "subscription archived or missing",
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const result = await attemptDelivery(deps, sub.url, sub.secret, delivery);
  const attempts = delivery.attempts + 1;
  const now = new Date();

  if (result.ok) {
    await deps.db
      .update(webhookDeliveries)
      .set({
        attempts,
        status: "delivered",
        lastAttemptAt: now,
        deliveredAt: now,
        lastFailureMessage: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    await deps.db
      .update(webhookSubscriptions)
      .set({ lastFiredAt: now, lastFailureMessage: null })
      .where(eq(webhookSubscriptions.id, sub.id));
    return;
  }

  if (attempts >= MAX_ATTEMPTS) {
    await deps.db
      .update(webhookDeliveries)
      .set({
        attempts,
        status: "dead",
        lastAttemptAt: now,
        deadAt: now,
        lastFailureMessage: result.message,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    await deps.db
      .update(webhookSubscriptions)
      .set({
        lastFiredAt: now,
        lastFailureMessage: `dead-letter after ${attempts} attempts: ${result.message}`,
      })
      .where(eq(webhookSubscriptions.id, sub.id));
    return;
  }

  // Schedule next retry. BACKOFF_SECONDS[attempts-1] is the delay
  // before the *next* attempt; arrays are 0-indexed so the first
  // failure (attempts=1) waits BACKOFF_SECONDS[1]=15s.
  const nextDelaySec = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)] ?? 1800;
  await deps.db
    .update(webhookDeliveries)
    .set({
      attempts,
      status: "retrying",
      lastAttemptAt: now,
      lastFailureMessage: result.message,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
  const queue = getWebhookQueue(deps);
  await queue.add(
    `webhook-${deliveryId}-retry-${attempts}`,
    { deliveryId },
    { delay: nextDelaySec * 1000 },
  );
}

async function attemptDelivery(
  deps: WebhookQueueDeps,
  url: string,
  sealedSecret: string,
  delivery: WebhookDeliveryRow,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const fetcher = deps.fetcher ?? fetch;
  let plaintextSecret: string;
  try {
    plaintextSecret = (deps.unsealSecret ?? ((s: string) => s))(sealedSecret);
  } catch (err) {
    return {
      ok: false,
      message: `secret unseal failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // DNS-rebinding guard: resolve hostname now, refuse if it lands in
  // any private/loopback/metadata range. Skipped when a stub fetcher
  // is supplied (tests).
  if (!deps.fetcher) {
    try {
      const u = new URL(url);
      const records = await lookup(u.hostname, { all: true });
      if (!records.every((r) => isPublicAddr(r.address))) {
        return { ok: false, message: "DNS-rebinding guard: hostname resolved to private address" };
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(delivery.body ?? {});
  const sig = createHmac("sha256", plaintextSecret).update(`${t}.${body}`).digest("hex");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vibe-Signature": `t=${t},v1=${sig}`,
        "X-Vibe-Action": delivery.action,
        "X-Vibe-Delivery-Id": delivery.id,
        "X-Vibe-Attempt": String(delivery.attempts + 1),
      },
      body,
      signal: ctrl.signal,
      redirect: "manual",
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function isPublicAddr(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0" || ip === "::") return false;
  if (ip === "169.254.169.254") return false;
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return false;
  return true;
}

/**
 * Phase 24.5 — admin re-drive of dead-letter rows. Resets attempts to
 * 0 and re-enqueues. Returns the number of rows redriven.
 */
export async function redriveDeadDeliveries(
  deps: WebhookQueueDeps,
  ids: string[],
): Promise<{ redriven: number }> {
  if (ids.length === 0) return { redriven: 0 };
  const rows = await deps.db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "dead")));
  const matched = rows.filter((r) => ids.includes(r.id));
  const queue = getWebhookQueue(deps);
  let redriven = 0;
  for (const row of matched) {
    await deps.db
      .update(webhookDeliveries)
      .set({ status: "pending", attempts: 0, deadAt: null })
      .where(eq(webhookDeliveries.id, row.id));
    await queue.add(
      `webhook-${row.id}-redrive`,
      { deliveryId: row.id },
      { jobId: `${row.id}-redrive-${Date.now()}` },
    );
    redriven++;
  }
  return { redriven };
}

/**
 * Sweep: find old `pending`/`retrying` rows that lost their BullMQ
 * job (e.g. Redis flush) and re-enqueue them. Called by a periodic
 * tick; idempotent.
 */
export async function sweepStuckDeliveries(deps: WebhookQueueDeps): Promise<{ requeued: number }> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const stuck = await deps.db
    .select()
    .from(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.status, "retrying"), lte(webhookDeliveries.lastAttemptAt, cutoff)),
    );
  const queue = getWebhookQueue(deps);
  for (const row of stuck) {
    await queue.add(
      `webhook-${row.id}-sweep`,
      { deliveryId: row.id },
      { jobId: `${row.id}-sweep-${Date.now()}` },
    );
  }
  return { requeued: stuck.length };
}

export const WEBHOOK_QUEUE_NAME = QUEUE_NAME;
export const WEBHOOK_BACKOFF_SECONDS = BACKOFF_SECONDS;
