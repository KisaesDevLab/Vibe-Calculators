import { pgTable, text, timestamp, integer, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { webhookSubscriptions } from "./api-keys";

/**
 * Phase 24.5 — webhook retry / dead-letter ledger.
 *
 * One row per (subscription, event) attempt chain. The BullMQ
 * retry queue carries the in-flight retries; this table is the
 * durable status the dead-letter UI / admin tools query. Backoff
 * ladder is exponential 5 / 15 / 60 / 300 / 1800 s (Phase 24.5);
 * after 5 failed attempts the row goes status='dead' and is no
 * longer redelivered.
 */

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "retrying",
  "dead",
]);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    lastFailureMessage: text("last_failure_message"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deadAt: timestamp("dead_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subscriptionIdx: index("webhook_deliveries_subscription_idx").on(t.subscriptionId, t.createdAt),
    statusIdx: index("webhook_deliveries_status_idx").on(t.status),
  }),
);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatusEnum.enumValues)[number];
