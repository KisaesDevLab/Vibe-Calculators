import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq, lte, and, isNotNull } from "drizzle-orm";
import {
  generateSchedule,
  money,
  rate,
  type CashFlowEvent,
  type CompoundingInterval,
  type ComputeMethod,
  type DayCountConvention,
} from "@vibe-calc/calc-engine";
import {
  scheduleToPdf,
  calculatorMemoToPdf,
  scheduleToXlsx,
  scheduleToCsv,
  scheduleToDocx,
} from "@vibe-calc/pdf";
import {
  exportJobs,
  calculations,
  type Database,
  type ExportJobKind,
  type ExportJobRow,
} from "@vibe-calc/db";
import { inArray } from "drizzle-orm";
import JSZip from "jszip";
import { logger } from "./logger.js";
import { loadFirmSettings, composeBrandedFooter } from "./firm-settings.js";
import { fireWebhookEvent, type WebhookQueueDeps } from "./webhook-queue.js";

/**
 * Phase 13.7 — async export queue.
 *
 * BullMQ over Redis. The queue name is `exports`; one in-process
 * Worker consumes it (concurrency 2 — PDF rendering is CPU-bound so
 * we cap below the typical container vCPU count to keep the API's
 * HTTP loop responsive). Job lifecycle:
 *
 *   1. POST /api/v1/exports inserts an export_jobs row with
 *      status='queued' and adds a BullMQ job referencing that row.
 *   2. Worker pulls the job, marks status='processing', renders the
 *      file under /data/exports/{user}/{calc}/{ts}.{ext}, updates
 *      file_path / size_bytes / status='done' / expires_at = +30d.
 *   3. Failure path: status='failed', error_message captured.
 *
 * The retention sweep runs every hour and unlinks files whose
 * expires_at has passed, then nulls the row's file_path so the UI
 * shows "Expired".
 *
 * Files live on the `pdf-output` Docker volume (compose mounts
 * /data/exports). The job row is the source of truth; if the
 * volume is wiped, jobs go to status='failed' on next attempt.
 */

const QUEUE_NAME = "exports";
const DEFAULT_DATA_DIR = process.env.VIBE_DATA_DIR ?? "/data";
const EXPORT_ROOT = path.join(DEFAULT_DATA_DIR, "exports");
const RETENTION_DAYS = Number(process.env.VIBE_EXPORT_RETENTION_DAYS ?? "30");
const MAX_BULK = 50;

export interface ExportQueueDeps {
  db: Database;
  redis: ConnectionOptions;
  /** Optional webhook queue — fires export.completed when present. */
  webhookQueue?: WebhookQueueDeps | undefined;
}

export interface ExportJobPayload {
  exportJobId: string;
}

export interface ExportEnqueueRequest {
  kind: ExportJobKind;
  /** For single-calc kinds. */
  calculationId?: string;
  /** For bulk-zip kinds. */
  calculationIds?: string[];
  options?: Record<string, unknown>;
  requestedBy: string;
}

let queueInstance: Queue<ExportJobPayload> | undefined;
let workerInstance: Worker<ExportJobPayload> | undefined;
let sweepHandle: ReturnType<typeof setInterval> | undefined;

/**
 * Lazy-initialize the queue. Safe to call multiple times — only the
 * first call constructs the BullMQ instance. Tests that don't want a
 * real worker just don't call startExportWorker.
 */
export function getExportQueue(deps: ExportQueueDeps): Queue<ExportJobPayload> {
  if (!queueInstance) {
    queueInstance = new Queue<ExportJobPayload>(QUEUE_NAME, {
      connection: deps.redis,
      defaultJobOptions: {
        // BullMQ retries with exponential backoff; we cap at 3 since
        // PDF render failures are rarely transient.
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return queueInstance;
}

/** Insert the export_jobs row + push the BullMQ job referencing its id. */
export async function enqueueExport(
  deps: ExportQueueDeps,
  request: ExportEnqueueRequest,
): Promise<ExportJobRow> {
  if (
    request.kind === "bulk-zip" &&
    (!request.calculationIds || request.calculationIds.length === 0)
  ) {
    throw new Error("bulk-zip export requires non-empty calculationIds");
  }
  if (request.kind !== "bulk-zip" && !request.calculationId) {
    throw new Error(`${request.kind} export requires calculationId`);
  }
  if (request.calculationIds && request.calculationIds.length > MAX_BULK) {
    throw new Error(`bulk-zip cap: ${MAX_BULK} calculations per call`);
  }

  const [row] = await deps.db
    .insert(exportJobs)
    .values({
      kind: request.kind,
      status: "queued",
      calculationId: request.calculationId ?? null,
      calculationIds: request.calculationIds ?? [],
      options: request.options ?? {},
      requestedBy: request.requestedBy,
    })
    .returning();
  if (!row) throw new Error("failed to insert export_jobs row");

  const queue = getExportQueue(deps);
  await queue.add(
    `export-${row.id}`,
    { exportJobId: row.id },
    { jobId: row.id }, // dedupes if the route somehow gets retried
  );
  return row;
}

/**
 * Start the in-process worker. Called once at API boot. Returns the
 * BullMQ Worker so the entry point can attach signal handlers.
 */
export function startExportWorker(deps: ExportQueueDeps): Worker<ExportJobPayload> {
  if (workerInstance) return workerInstance;
  workerInstance = new Worker<ExportJobPayload>(
    QUEUE_NAME,
    async (job) => {
      await processExportJob(deps, job.data.exportJobId);
    },
    {
      connection: deps.redis,
      // concurrency 1 by default. PDF rendering is CPU-bound and runs
      // in the same process as the HTTP loop; two parallel renders
      // can starve the event loop long enough for the 3s healthcheck
      // to fail and trigger a container restart. Operators with a
      // dedicated worker box can bump this via env.
      concurrency: Number(process.env.VIBE_EXPORT_CONCURRENCY ?? "1"),
    },
  );
  workerInstance.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, exportJobId: job?.data?.exportJobId, err: err.message },
      "export job failed",
    );
  });
  workerInstance.on("completed", (job) => {
    logger.info({ jobId: job.id, exportJobId: job.data.exportJobId }, "export job completed");
  });

  // Retention sweep. Hourly is fine — files past expires_at hang
  // around at most an hour after expiry, well within the 30d budget.
  if (!sweepHandle) {
    const sweepIntervalMs = Number(process.env.VIBE_EXPORT_SWEEP_INTERVAL_MS ?? 3600_000);
    sweepHandle = setInterval(() => {
      void runRetentionSweep(deps).catch((err) =>
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "retention sweep error",
        ),
      );
    }, sweepIntervalMs);
    if (sweepHandle.unref) sweepHandle.unref();
  }

  return workerInstance;
}

export async function stopExportWorker(): Promise<void> {
  if (sweepHandle) {
    clearInterval(sweepHandle);
    sweepHandle = undefined;
  }
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
// Worker job processing
// ---------------------------------------------------------------------

async function processExportJob(deps: ExportQueueDeps, exportJobId: string): Promise<void> {
  const [job] = await deps.db
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.id, exportJobId))
    .limit(1);
  if (!job) {
    logger.warn({ exportJobId }, "export job row missing — dropping");
    return;
  }

  await deps.db
    .update(exportJobs)
    .set({ status: "processing", startedAt: new Date(), progress: 5 })
    .where(eq(exportJobs.id, exportJobId));

  try {
    const firm = await loadFirmSettings(deps.db);
    const brandedFooter = composeBrandedFooter(firm, undefined);
    const branding = {
      ...(firm?.firmName ? { firmName: firm.firmName } : {}),
      ...(brandedFooter ? { firmFooter: brandedFooter } : {}),
    } as { firmName?: string; firmFooter?: string };

    const userId = job.requestedBy ?? "system";
    const ts = Date.now();
    let buffer: Buffer;
    let filename: string;

    if (job.kind === "bulk-zip") {
      const ids = job.calculationIds ?? [];
      const rows = ids.length
        ? await deps.db.select().from(calculations).where(inArray(calculations.id, ids))
        : [];
      const zip = new JSZip();
      const errors: string[] = [];
      let written = 0;
      const opts = job.options ?? {};
      const watermark =
        typeof opts.watermark === "string" && opts.watermark.length > 0
          ? opts.watermark
          : opts.draft === true
            ? "DRAFT — Not for Distribution"
            : undefined;
      for (const calc of rows) {
        try {
          const buf = await renderSingleCalc(
            calc.kind,
            calc.name,
            calc.inputsJson,
            calc.outputsJson,
            branding,
            watermark,
          );
          const safe = calc.name.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
          zip.file(`${safe}-${calc.id.slice(0, 8)}.pdf`, buf);
          written++;
        } catch (err) {
          errors.push(
            `${calc.id}\t${calc.name}\t${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (errors.length > 0) {
        zip.file(
          "errors.txt",
          `Failed to render ${errors.length} of ${rows.length}.\n\n${errors.join("\n")}\n`,
        );
      }
      if (written === 0) throw new Error("bulk-zip: no calculations rendered");
      buffer = await zip.generateAsync({ type: "nodebuffer" });
      filename = `calculations-${new Date().toISOString().slice(0, 10)}-${written}.zip`;
    } else {
      const calcId = job.calculationId;
      if (!calcId) throw new Error("missing calculationId on single-calc export");
      const [calc] = await deps.db
        .select()
        .from(calculations)
        .where(eq(calculations.id, calcId))
        .limit(1);
      if (!calc) throw new Error("calculation not found");
      buffer = await renderForKind(
        job.kind,
        calc.kind,
        calc.name,
        calc.inputsJson,
        calc.outputsJson,
        branding,
        job.options ?? {},
      );
      const ext = extensionFor(job.kind);
      const safe = calc.name.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
      filename = `${safe}-${calc.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    }

    const dir = path.join(EXPORT_ROOT, userId, job.calculationId ?? job.id);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${ts}-${filename}`);
    await fs.writeFile(filePath, buffer);

    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 86_400_000);
    await deps.db
      .update(exportJobs)
      .set({
        status: "done",
        filename,
        filePath,
        sizeBytes: buffer.length,
        progress: 100,
        completedAt: new Date(),
        expiresAt,
        errorMessage: null,
      })
      .where(eq(exportJobs.id, exportJobId));
    if (deps.webhookQueue) {
      await fireWebhookEvent(deps.webhookQueue, {
        action: "export.completed",
        entityKind: "calculation",
        entityId: job.calculationId ?? job.id,
        payload: {
          exportJobId,
          kind: job.kind,
          filename,
          sizeBytes: buffer.length,
          requestedBy: userId,
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(exportJobs)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
        progress: 100,
      })
      .where(eq(exportJobs.id, exportJobId));
    throw err; // BullMQ will retry up to attempts
  }
}

async function renderForKind(
  exportKind: ExportJobKind,
  calcKind: string,
  name: string,
  inputs: unknown,
  outputs: unknown,
  branding: { firmName?: string; firmFooter?: string },
  options: Record<string, unknown>,
): Promise<Buffer> {
  const inp = (inputs ?? {}) as Record<string, unknown>;
  const out = (outputs ?? {}) as Record<string, unknown>;

  // Phase 13.10 — opt-in watermark. Empty / undefined emits no
  // watermark; a string is overlaid on the PDF (engine already
  // supports the `watermark` field on both renderer paths).
  const watermark =
    typeof options.watermark === "string" && options.watermark.length > 0
      ? options.watermark
      : options.draft === true
        ? "DRAFT — Not for Distribution"
        : undefined;

  switch (exportKind) {
    case "tvm-pdf":
    case "memo-pdf":
      return renderSingleCalc(calcKind, name, inp, out, branding, watermark);
    case "xlsx": {
      const schedule = scheduleFromInputs(inp);
      const buf = await scheduleToXlsx(schedule, {
        calculationLabel: name,
        ...(branding.firmName ? { firmName: branding.firmName } : {}),
      });
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }
    case "csv": {
      const schedule = scheduleFromInputs(inp);
      const csv = scheduleToCsv(schedule, { bom: options.bom === true });
      return Buffer.from(csv, "utf-8");
    }
    case "docx": {
      const schedule = scheduleFromInputs(inp);
      const buf = await scheduleToDocx(schedule, {
        calculationLabel: name,
        ...(branding.firmName ? { firmName: branding.firmName } : {}),
      });
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }
    default:
      throw new Error(`unsupported export kind: ${exportKind}`);
  }
}

async function renderSingleCalc(
  calcKind: string,
  name: string,
  inputs: unknown,
  outputs: unknown,
  branding: { firmName?: string; firmFooter?: string },
  watermark?: string,
): Promise<Buffer> {
  const inp = (inputs ?? {}) as Record<string, unknown>;
  const out = (outputs ?? {}) as Record<string, unknown>;
  if (calcKind === "tvm") {
    const schedule = scheduleFromInputs(inp);
    return scheduleToPdf(schedule, {
      calculationLabel: name,
      preparedBy: "(queued export)",
      preparedOn: new Date(),
      ...branding,
      ...(watermark ? { watermark } : {}),
    });
  }
  return calculatorMemoToPdf({
    kind: calcKind,
    name,
    inputs: inp,
    outputs: out,
    narrative: typeof out.narrative === "string" ? out.narrative : "",
    formReferences: [],
    preparedBy: "(queued export)",
    preparedOn: new Date(),
    ...branding,
    ...(watermark ? { watermark } : {}),
  });
}

function scheduleFromInputs(inp: Record<string, unknown>): ReturnType<typeof generateSchedule> {
  const master = (inp.master ?? {}) as {
    rate?: string;
    compounding?: CompoundingInterval;
    dayCount?: DayCountConvention;
    paymentTiming?: 0 | 1;
    computeMethod?: ComputeMethod;
  };
  const rows = (
    (inp.rows ?? []) as Array<{
      date?: string;
      kind?: CashFlowEvent["kind"];
      amount?: string;
      rateValue?: string;
      count?: string;
      interval?: CompoundingInterval | "";
      memo?: string;
    }>
  ).filter((r) => r.date && r.kind);
  const events: CashFlowEvent[] = rows.map((r) => {
    const e: CashFlowEvent = {
      date: new Date(`${r.date}T00:00:00.000Z`),
      kind: r.kind as CashFlowEvent["kind"],
    };
    if (r.amount) e.amount = money(r.amount);
    if (r.rateValue) e.rate = rate(r.rateValue);
    if (r.count) e.count = Number(r.count);
    if (r.interval) e.interval = r.interval as CompoundingInterval;
    if (r.memo) e.memo = r.memo;
    return e;
  });
  if (events.length === 0) throw new Error("TVM calc has no rows to render");
  return generateSchedule(events, {
    rate: rate(master.rate ?? "0"),
    compounding: master.compounding ?? "monthly",
    dayCount: master.dayCount ?? "30/360",
    paymentTiming: master.paymentTiming ?? 0,
    computeMethod: master.computeMethod ?? "Normal",
  });
}

function extensionFor(kind: ExportJobKind): string {
  switch (kind) {
    case "tvm-pdf":
    case "memo-pdf":
      return "pdf";
    case "xlsx":
      return "xlsx";
    case "csv":
      return "csv";
    case "docx":
      return "docx";
    case "bulk-zip":
      return "zip";
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown export kind: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------
// Retention sweep
// ---------------------------------------------------------------------

export async function runRetentionSweep(deps: ExportQueueDeps): Promise<{
  unlinked: number;
  freedBytes: number;
}> {
  const now = new Date();
  const expired = await deps.db
    .select()
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.status, "done"),
        isNotNull(exportJobs.filePath),
        lte(exportJobs.expiresAt, now),
      ),
    );
  let unlinked = 0;
  let freedBytes = 0;
  for (const row of expired) {
    if (!row.filePath) continue;
    try {
      const stat = await fs.stat(row.filePath).catch(() => null);
      if (stat) {
        await fs.unlink(row.filePath);
        freedBytes += stat.size;
      }
      await deps.db.update(exportJobs).set({ filePath: null }).where(eq(exportJobs.id, row.id));
      unlinked++;
    } catch (err) {
      logger.warn(
        { exportJobId: row.id, err: err instanceof Error ? err.message : String(err) },
        "retention sweep failed to unlink",
      );
    }
  }
  if (unlinked > 0) {
    logger.info({ unlinked, freedBytes }, "export retention sweep");
  }
  return { unlinked, freedBytes };
}

export const EXPORT_QUEUE_NAME = QUEUE_NAME;
export const EXPORT_ROOT_DIR = EXPORT_ROOT;
