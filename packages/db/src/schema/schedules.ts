import { pgTable, text, timestamp, jsonb, pgEnum, index, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { calculations } from "./calculations";

/**
 * Phase 22.4 — schedules + schedule_instances.
 *
 * A `schedule` is a recurring directive: re-run a saved calculation
 * on a cadence and email the PDF to a recipient. Each scheduled
 * execution writes a `schedule_instances` row capturing the
 * computed-at timestamp, status, and any delivery metadata.
 */

export const scheduleCadenceEnum = pgEnum("schedule_cadence", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annually",
  "once",
]);

export const scheduleStatusEnum = pgEnum("schedule_status", [
  "active",
  "paused",
  "completed",
  "failed",
]);

export const scheduleInstanceStatusEnum = pgEnum("schedule_instance_status", [
  "queued",
  "running",
  "delivered",
  "failed",
]);

export const schedules = pgTable(
  "schedules",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    calculationId: text("calculation_id")
      .notNull()
      .references(() => calculations.id, { onDelete: "cascade" }),
    cadence: scheduleCadenceEnum("cadence").notNull(),
    /** UTC HH:MM time of day for the run. Defaults to 09:00 UTC. */
    sendAt: text("send_at").notNull().default("09:00"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    /** Recipients (comma-separated emails). */
    recipients: text("recipients").notNull(),
    /** Subject template (Mustache-lite — {{calc.name}}, {{run.date}}). */
    subject: text("subject").notNull(),
    /** Optional cover note. */
    body: text("body"),
    status: scheduleStatusEnum("status").notNull().default("active"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    calcIdx: index("schedules_calc_idx").on(t.calculationId),
    nextRunIdx: index("schedules_next_run_idx").on(t.nextRunAt),
    statusIdx: index("schedules_status_idx").on(t.status),
  }),
);

export type ScheduleRow = typeof schedules.$inferSelect;
export type NewScheduleRow = typeof schedules.$inferInsert;
export type ScheduleCadence = (typeof scheduleCadenceEnum.enumValues)[number];
export type ScheduleStatus = (typeof scheduleStatusEnum.enumValues)[number];

export const scheduleInstances = pgTable(
  "schedule_instances",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: scheduleInstanceStatusEnum("status").notNull().default("queued"),
    /** Provider's message-id on success; error message on failure. */
    deliveryDetails: jsonb("delivery_details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Snapshot of the computed-result outputs for replay. */
    outputsSnapshot: jsonb("outputs_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Retry counter (for transient delivery failures). */
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => ({
    scheduleIdx: index("schedule_instances_schedule_idx").on(t.scheduleId),
    runAtIdx: index("schedule_instances_run_at_idx").on(t.runAt),
    statusIdx: index("schedule_instances_status_idx").on(t.status),
  }),
);

export type ScheduleInstanceRow = typeof scheduleInstances.$inferSelect;
export type NewScheduleInstanceRow = typeof scheduleInstances.$inferInsert;
export type ScheduleInstanceStatus = (typeof scheduleInstanceStatusEnum.enumValues)[number];
