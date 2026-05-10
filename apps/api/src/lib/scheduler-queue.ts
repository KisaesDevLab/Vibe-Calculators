import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  schedules,
  scheduleInstances,
  calculations,
  calculationVersions,
  type Database,
  type ScheduleCadence,
} from "@vibe-calc/db";
import type { EmailProvider } from "@vibe-calc/email";
import { nextRunAt } from "./schedule-tick.js";
import { logger } from "./logger.js";
import { loadFirmSettings } from "./firm-settings.js";

/**
 * Phase 22.1 — repeatable scheduled-recompute tick.
 *
 * BullMQ repeatable job that fires every TICK_INTERVAL minutes,
 * picks up every schedule whose next_run_at is past, and processes
 * the recompute. The same work is exposed via POST /api/v1/schedules/tick
 * for ad-hoc admin runs and integration tests.
 *
 * Design rationale: keeping the worker in-process (rather than a
 * separate vibecalc-worker container) means one less moving part
 * for the operator. Tick runs are I/O-bound (DB reads + optional
 * SMTP); the export worker holds CPU-bound concurrency=1, the
 * webhook worker concurrency=4, this scheduler tick concurrency=1.
 */

const QUEUE_NAME = "scheduler";
const TICK_JOB_NAME = "tick";
const TICK_INTERVAL_MS = Number(process.env.VIBE_SCHEDULER_TICK_INTERVAL_MS ?? 5 * 60_000);
const BATCH_SIZE = 50;

export interface SchedulerQueueDeps {
  db: Database;
  redis: ConnectionOptions;
  resolveEmailProvider?: (() => Promise<EmailProvider | null>) | undefined;
}

let queueInstance: Queue | undefined;
let workerInstance: Worker | undefined;

export async function startSchedulerWorker(deps: SchedulerQueueDeps): Promise<Worker> {
  if (workerInstance) return workerInstance;
  queueInstance = new Queue(QUEUE_NAME, { connection: deps.redis });
  // Drain stale repeatable jobs from prior boot cycles. BullMQ's
  // repeatable scheduler keys live in Redis and survive restart;
  // adding the same one twice would cause double-firing.
  const repeatables = await queueInstance.getRepeatableJobs();
  for (const r of repeatables) {
    if (r.name === TICK_JOB_NAME) {
      await queueInstance.removeRepeatableByKey(r.key);
    }
  }
  await queueInstance.add(
    TICK_JOB_NAME,
    {},
    { repeat: { every: TICK_INTERVAL_MS }, jobId: TICK_JOB_NAME },
  );

  workerInstance = new Worker(
    QUEUE_NAME,
    async () => {
      await runDueSchedules(deps);
    },
    { connection: deps.redis, concurrency: 1 },
  );
  workerInstance.on("failed", (_job, err) => {
    logger.error({ err: err.message }, "scheduler tick failed");
  });
  return workerInstance;
}

export async function stopSchedulerWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = undefined;
  }
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = undefined;
  }
}

/**
 * Process every schedule whose next_run_at is in the past. Mirrors
 * the manual POST /api/v1/schedules/tick flow. Failures on individual
 * schedules are logged but don't abort the batch.
 */
export async function runDueSchedules(deps: SchedulerQueueDeps): Promise<{ ran: number }> {
  const now = new Date();
  const due = await deps.db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.status, "active"),
        isNull(schedules.archivedAt),
        lte(schedules.nextRunAt, now),
      ),
    )
    .limit(BATCH_SIZE);
  let ran = 0;
  for (const s of due) {
    try {
      // Claim-then-advance, mirroring the manual /tick implementation:
      // SELECT FOR UPDATE SKIP LOCKED so two parallel ticks (e.g. an
      // unattended worker plus an admin /tick) can't double-fire.
      await deps.db.transaction(async (tx) => {
        const claim = await tx.execute(
          sql`SELECT id FROM schedules WHERE id = ${s.id} FOR UPDATE SKIP LOCKED`,
        );
        const claimed = (claim as unknown as { rows: { id: string }[] }).rows ?? [];
        if (claimed.length === 0) return;
        const advance = nextRunAt(s.cadence as ScheduleCadence, now);
        await tx
          .update(schedules)
          .set({
            nextRunAt: advance ?? now,
            status: advance ? "active" : "completed",
            updatedAt: now,
          })
          .where(eq(schedules.id, s.id));
        await processScheduleInstance(tx, deps, s);
      });
      ran++;
    } catch (err) {
      logger.error(
        { scheduleId: s.id, err: err instanceof Error ? err.message : String(err) },
        "schedule run failed",
      );
    }
  }
  if (ran > 0) {
    logger.info({ ran }, "scheduler tick processed schedules");
  }
  return { ran };
}

async function processScheduleInstance(
  tx: Database,
  deps: SchedulerQueueDeps,
  schedule: typeof schedules.$inferSelect,
): Promise<void> {
  // Snapshot the calc's current version + outputs into a schedule_instances
  // row. The actual recompute is delegated to the calculator router via
  // a feature flag in the build plan; for the scheduler we record the
  // snapshot so the operator has an audit trail of the run.
  const [calc] = await tx
    .select()
    .from(calculations)
    .where(eq(calculations.id, schedule.calculationId))
    .limit(1);
  if (!calc) return;
  const [version] = calc.currentVersionId
    ? await tx
        .select()
        .from(calculationVersions)
        .where(eq(calculationVersions.id, calc.currentVersionId))
        .limit(1)
    : [];
  await tx.insert(scheduleInstances).values({
    scheduleId: schedule.id,
    status: "delivered",
    runAt: new Date(),
    completedAt: new Date(),
    outputsSnapshot: {
      inputs: calc.inputsJson,
      outputs: calc.outputsJson,
      versionId: version?.id ?? null,
    },
  });
  // Email notification — best-effort; missing provider is fine.
  const provider = deps.resolveEmailProvider ? await deps.resolveEmailProvider() : null;
  if (provider && schedule.recipients.trim().length > 0) {
    try {
      const firm = await loadFirmSettings(deps.db).catch(() => null);
      const { renderScheduledRecomputeEmail } = await import("@vibe-calc/email");
      const rendered = renderScheduledRecomputeEmail({
        scheduleName: schedule.subject,
        calcName: calc.name,
        computedAt: new Date(),
        ...(firm
          ? {
              brand: {
                firmName: firm.firmName ?? undefined,
                brandColor: firm.brandColor ?? undefined,
                firmFooter: firm.pdfFooter ?? undefined,
              },
            }
          : {}),
      });
      const recipients = schedule.recipients
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      await Promise.allSettled(
        recipients.map((to) =>
          provider.send({
            to,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          }),
        ),
      );
    } catch (err) {
      logger.warn(
        { scheduleId: schedule.id, err: err instanceof Error ? err.message : String(err) },
        "scheduled-recompute email send failed",
      );
    }
  }
}

export const SCHEDULER_QUEUE_NAME = QUEUE_NAME;
export const SCHEDULER_TICK_INTERVAL_MS = TICK_INTERVAL_MS;
