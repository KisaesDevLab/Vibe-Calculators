/**
 * Phase 3.7 — Drizzle relations between domain tables.
 *
 * These power the relational query API:
 *   db.query.clients.findFirst({ with: { engagements: { with: { calculations: true } } } })
 */

import { relations } from "drizzle-orm";
import { users } from "./users";
import { sessions } from "./sessions";
import { recoveryCodes } from "./recovery-codes";
import { clients } from "./clients";
import { engagements } from "./engagements";
import { calculations, calculationVersions } from "./calculations";
import { tags, entityTags } from "./tags";

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  recoveryCodes: many(recoveryCodes),
  createdClients: many(clients, { relationName: "clients_created_by" }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const recoveryCodesRelations = relations(recoveryCodes, ({ one }) => ({
  user: one(users, { fields: [recoveryCodes.userId], references: [users.id] }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [clients.createdBy],
    references: [users.id],
    relationName: "clients_created_by",
  }),
  engagements: many(engagements),
  calculations: many(calculations),
}));

export const engagementsRelations = relations(engagements, ({ one, many }) => ({
  client: one(clients, { fields: [engagements.clientId], references: [clients.id] }),
  preparer: one(users, {
    fields: [engagements.assignedPreparerId],
    references: [users.id],
    relationName: "engagement_preparer",
  }),
  reviewer: one(users, {
    fields: [engagements.assignedReviewerId],
    references: [users.id],
    relationName: "engagement_reviewer",
  }),
  calculations: many(calculations),
}));

export const calculationsRelations = relations(calculations, ({ one, many }) => ({
  client: one(clients, { fields: [calculations.clientId], references: [clients.id] }),
  engagement: one(engagements, {
    fields: [calculations.engagementId],
    references: [engagements.id],
  }),
  parent: one(calculations, {
    fields: [calculations.parentId],
    references: [calculations.id],
    relationName: "calc_parent",
  }),
  computedBy: one(users, {
    fields: [calculations.computedBy],
    references: [users.id],
    relationName: "calc_computed_by",
  }),
  versions: many(calculationVersions),
}));

export const calculationVersionsRelations = relations(calculationVersions, ({ one }) => ({
  calculation: one(calculations, {
    fields: [calculationVersions.calculationId],
    references: [calculations.id],
  }),
  computedBy: one(users, {
    fields: [calculationVersions.computedBy],
    references: [users.id],
    relationName: "calc_version_computed_by",
  }),
  lockedBy: one(users, {
    fields: [calculationVersions.lockedBy],
    references: [users.id],
    relationName: "calc_version_locked_by",
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  edges: many(entityTags),
}));

export const entityTagsRelations = relations(entityTags, ({ one }) => ({
  tag: one(tags, { fields: [entityTags.tagId], references: [tags.id] }),
}));
