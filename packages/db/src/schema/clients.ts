import { pgTable, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Phase 3.1 — clients.
 *
 * One row per CPA-firm client. address_json and primary_contact_json
 * are jsonb so we can iterate the shape without migrations during
 * the early phases; Phase 25 freezes them via a Zod-derived JSON
 * schema if needed.
 */

export const clientEntityTypeEnum = pgEnum("client_entity_type", [
  "individual",
  "sole_prop",
  "single_member_llc",
  "multi_member_llc",
  "s_corp",
  "c_corp",
  "partnership",
  "trust",
  "estate",
  "nonprofit",
  "other",
]);

export interface ClientAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ClientContact {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
}

export const clients = pgTable(
  "clients",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    entityType: clientEntityTypeEnum("entity_type").notNull().default("individual"),
    ein: text("ein"),
    addressJson: jsonb("address_json").$type<ClientAddress>().notNull().default({}),
    primaryContactJson: jsonb("primary_contact_json").$type<ClientContact>().notNull().default({}),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    nameIdx: index("clients_name_idx").on(t.name),
    archivedIdx: index("clients_archived_idx").on(t.archivedAt),
  }),
);

export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
export type ClientEntityType = (typeof clientEntityTypeEnum.enumValues)[number];
