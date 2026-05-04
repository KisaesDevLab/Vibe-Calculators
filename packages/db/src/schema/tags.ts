import { pgTable, text, timestamp, uniqueIndex, index, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 3.5 — tags + entity_tags polymorphic join.
 *
 * Tag *names* are unique per firm (we'll add multi-tenant scoping
 * once the firm model lands; for now the firm = the appliance).
 * `entity_tags` is the polymorphic edge: (entity_type, entity_id) ->
 * tag_id. The (entity_type, entity_id) pair is indexed but is *not*
 * a foreign key, since the referenced table differs by entity_type.
 * Application-level integrity is enforced via the typed insert
 * helpers in queries/tags.ts.
 */

export const taggedEntityKindEnum = pgEnum("tagged_entity_kind", [
  "client",
  "engagement",
  "calculation",
]);

export const tags = pgTable(
  "tags",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameUnique: uniqueIndex("tags_name_unique").on(t.name),
  }),
);

export const entityTags = pgTable(
  "entity_tags",
  {
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityKind: taggedEntityKindEnum("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: uniqueIndex("entity_tags_pk").on(t.tagId, t.entityKind, t.entityId),
    entityIdx: index("entity_tags_entity_idx").on(t.entityKind, t.entityId),
  }),
);

export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;
export type EntityTagRow = typeof entityTags.$inferSelect;
export type NewEntityTagRow = typeof entityTags.$inferInsert;
export type TaggedEntityKind = (typeof taggedEntityKindEnum.enumValues)[number];
