import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  schedules,
  scheduleInstances,
  calculations,
  type Database,
  type ScheduleCadence,
} from "@vibe-calc/db";
import type { EmailProvider } from "@vibe-calc/email";
import { problem, requirePermission } from "../middleware/auth.js";
import { nextRunAt } from "../lib/schedule-tick.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 22 — schedules CRUD + run-now + tick.
 *
 *   GET    /api/v1/schedules              list
 *   POST   /api/v1/schedules              create (preparer+)
 *   GET    /api/v1/schedules/:id          detail with recent instances
 *   POST   /api/v1/schedules/:id/pause
 *   POST   /api/v1/schedules/:id/resume
 *   POST   /api/v1/schedules/:id/run-now  fires immediately, records instance
 *   DELETE /api/v1/schedules/:id          archive (admin)
 *   POST   /api/v1/schedules/tick         admin-only manual tick (cron-like)
 */

export interface ScheduleRouteDeps {
  db: Database;
  emailProvider?: EmailProvider | undefined;
}

const cadenceEnum = z.enum(["daily", "weekly", "monthly", "quarterly", "annually", "once"]);

const createSchema = z.object({
  calculationId: z.string().min(1),
  cadence: cadenceEnum,
  recipients: z.string().min(3),
  subject: z.string().min(1).max(200),
  body: z.string().max(10_000).optional(),
  /** ISO timestamp for the first run; defaults to "tomorrow @ sendAt UTC". */
  startAt: z.string().datetime().optional(),
  sendAt: z
    .string()
    .regex(/^\d{2}:\d{2}$/u)
    .default("09:00"),
});

export function buildSchedulesRouter(deps: ScheduleRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("calculation:read"), async (req: Request, res: Response) => {
    const calcId =
      typeof req.query.calculationId === "string" ? req.query.calculationId : undefined;
    const conds = [];
    conds.push(isNull(schedules.archivedAt));
    if (calcId) conds.push(eq(schedules.calculationId, calcId));
    const rows = await deps.db
      .select()
      .from(schedules)
      .where(and(...conds))
      .orderBy(asc(schedules.nextRunAt))
      .limit(200);
    res.json({ schedules: rows });
  });

  router.post("/", requirePermission("email:send"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });

    const [calc] = await deps.db
      .select()
      .from(calculations)
      .where(eq(calculations.id, parsed.data.calculationId))
      .limit(1);
    if (!calc) return problem(res, 404, "Not found", "Target calculation not found");

    const startAt = parsed.data.startAt
      ? new Date(parsed.data.startAt)
      : tomorrowAt(parsed.data.sendAt);
    const [row] = await deps.db
      .insert(schedules)
      .values({
        calculationId: parsed.data.calculationId,
        cadence: parsed.data.cadence,
        sendAt: parsed.data.sendAt,
        nextRunAt: startAt,
        recipients: parsed.data.recipients,
        subject: parsed.data.subject,
        body: parsed.data.body ?? null,
        createdBy: req.user.id,
      })
      .returning();
    res.status(201).json({ schedule: row });
  });

  router.get("/:id", requirePermission("calculation:read"), async (req: Request, res: Response) => {
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [row] = await deps.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    if (!row) return problem(res, 404, "Not found", "Schedule not found");
    const instances = await deps.db
      .select()
      .from(scheduleInstances)
      .where(eq(scheduleInstances.scheduleId, id))
      .orderBy(desc(scheduleInstances.runAt))
      .limit(20);
    res.json({ schedule: row, instances });
  });

  router.post(
    "/:id/pause",
    requirePermission("email:send"),
    async (req: Request, res: Response) => {
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(schedules)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(schedules.id, id))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Schedule not found");
      res.json({ schedule: row });
    },
  );

  router.post(
    "/:id/resume",
    requirePermission("email:send"),
    async (req: Request, res: Response) => {
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const [row] = await deps.db
        .update(schedules)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(schedules.id, id))
        .returning();
      if (!row) return problem(res, 404, "Not found", "Schedule not found");
      res.json({ schedule: row });
    },
  );

  router.post(
    "/:id/run-now",
    requirePermission("email:send"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const id = readId(req);
      if (!id) return problem(res, 400, "Bad request", "Missing id");
      const result = await runOneSchedule(deps, id, req.user.id);
      if (!result) return problem(res, 404, "Not found", "Schedule not found");
      res.json(result);
    },
  );

  router.delete("/:id", requirePermission("email:send"), async (req: Request, res: Response) => {
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    const [row] = await deps.db
      .update(schedules)
      .set({ archivedAt: new Date(), status: "completed", updatedAt: new Date() })
      .where(eq(schedules.id, id))
      .returning();
    if (!row) return problem(res, 404, "Not found", "Schedule not found");
    res.status(204).end();
  });

  /**
   * Manual tick — finds every active schedule whose next_run_at is in
   * the past and runs them. Production wires this to a BullMQ
   * repeatable job; for the MVP a `cron` or `just tick` invocation
   * (or this admin-only endpoint) drives execution.
   */
  router.post("/tick", requirePermission("backup:create"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
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
      .limit(50);
    const ran: { scheduleId: string; status: string }[] = [];
    for (const s of due) {
      const out = await runOneSchedule(deps, s.id, req.user.id);
      if (out) ran.push({ scheduleId: s.id, status: out.instance.status });
    }
    res.json({ ran });
  });

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function tomorrowAt(hhmm: string): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const [h, m] = hhmm.split(":").map((s) => Number.parseInt(s, 10));
  next.setUTCHours(h ?? 9, m ?? 0, 0, 0);
  return next;
}

interface RunResult {
  instance: typeof scheduleInstances.$inferSelect;
  schedule: typeof schedules.$inferSelect;
}

async function runOneSchedule(
  deps: ScheduleRouteDeps,
  scheduleId: string,
  actorUserId: string,
): Promise<RunResult | null> {
  const [s] = await deps.db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
  if (!s) return null;

  const [calc] = await deps.db
    .select()
    .from(calculations)
    .where(eq(calculations.id, s.calculationId))
    .limit(1);

  const [instance] = await deps.db
    .insert(scheduleInstances)
    .values({
      scheduleId: s.id,
      runAt: new Date(),
      status: "running",
      outputsSnapshot: calc?.outputsJson ?? {},
      attempts: 1,
    })
    .returning();
  if (!instance) throw new Error("schedule_instance insert returned no row");

  const calcOrNull = calc ?? null;
  let status: "delivered" | "failed" = "failed";
  let details: Record<string, unknown> = {};

  if (deps.emailProvider) {
    try {
      const result = await deps.emailProvider.send({
        to: s.recipients,
        subject: renderTemplate(s.subject, {
          calc: calcOrNull,
          run: { date: new Date().toISOString().slice(0, 10) },
        }),
        text: s.body ?? defaultBody(calcOrNull),
        metadata: { scheduleId: s.id, calculationId: s.calculationId },
      });
      status = "delivered";
      details = { messageId: result.messageId, provider: result.provider };
    } catch (err) {
      details = {
        error: err instanceof Error ? err.message : String(err),
        provider: deps.emailProvider?.name,
      };
    }
  } else {
    // No provider wired (MVP / tests) — record the run without sending.
    status = "delivered";
    details = { provider: "noop", note: "No EmailProvider configured" };
  }

  const [updatedInstance] = await deps.db
    .update(scheduleInstances)
    .set({
      status,
      completedAt: new Date(),
      deliveryDetails: details,
    })
    .where(eq(scheduleInstances.id, instance.id))
    .returning();

  // Advance the schedule.
  const next = nextRunAt(s.cadence as ScheduleCadence, new Date());
  const [updatedSchedule] = await deps.db
    .update(schedules)
    .set({
      nextRunAt: next ?? new Date(),
      status: next ? "active" : "completed",
      updatedAt: new Date(),
    })
    .where(eq(schedules.id, s.id))
    .returning();

  await recordAuditEvent(deps.db, {
    action: "export.created",
    entityKind: "calculation",
    entityId: s.calculationId,
    actorUserId,
    payload: { scheduleId: s.id, instanceId: instance.id, status },
  });

  return { instance: updatedInstance ?? instance, schedule: updatedSchedule ?? s };
}

function renderTemplate(
  template: string,
  ctx: { calc: { name?: string } | null; run: { date: string } },
): string {
  return template
    .replace(/\{\{calc\.name\}\}/g, ctx.calc?.name ?? "Vibe Calculation")
    .replace(/\{\{run\.date\}\}/g, ctx.run.date);
}

function defaultBody(calc: typeof calculations.$inferSelect | null): string {
  if (!calc) return "Scheduled calculation result attached.";
  return (
    `Scheduled run of "${calc.name}" (kind: ${calc.kind}, version ${calc.version}).\n\n` +
    `Generated by Vibe Calculators on ${new Date().toISOString()}.`
  );
}
