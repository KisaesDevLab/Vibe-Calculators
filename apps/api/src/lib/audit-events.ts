import { createHash } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import {
  auditEvents,
  AUDIT_EVENTS_GENESIS_HASH,
  type AuditAction,
  type AuditEntityKind,
  type AuditEventRow,
  type Database,
} from "@vibe-calc/db";

/**
 * Phase 21.3 — domain audit log writer + chain validator.
 *
 * Mirrors apps/api/src/lib/auth-events.ts for the auth chain. Both
 * chains run in parallel — auth events go to auth_events, domain
 * events go to audit_events.
 *
 * Hash:
 *   row_hash = sha256(prev_hash || "|" || canonical(record))
 * where `record` is every column except row_hash itself, with
 * canonical key ordering and ISO-formatted timestamp.
 */

interface RecordedFields {
  id: string;
  createdAt: Date;
  action: AuditAction;
  entityKind: AuditEntityKind;
  entityId: string;
  actorUserId: string | null;
  payload: Record<string, unknown>;
}

function sortKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortKeys);
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return input;
}

function canonicalize(fields: RecordedFields): string {
  const ordered = {
    action: fields.action,
    actorUserId: fields.actorUserId,
    createdAt: fields.createdAt.toISOString(),
    entityId: fields.entityId,
    entityKind: fields.entityKind,
    id: fields.id,
    payload: sortKeys(fields.payload),
  };
  return JSON.stringify(ordered);
}

export function computeAuditRowHash(prevHash: string, fields: RecordedFields): string {
  return createHash("sha256")
    .update(prevHash)
    .update("|")
    .update(canonicalize(fields))
    .digest("hex");
}

export interface RecordAuditEventInput {
  action: AuditAction;
  entityKind: AuditEntityKind;
  entityId: string;
  actorUserId?: string | undefined;
  payload?: Record<string, unknown>;
  now?: Date;
}

/**
 * Append a domain audit row. Reads the most recent row's hash to
 * use as prev_hash, or the genesis sentinel if the table is empty.
 *
 * The same caveat as auth-events applies: NOT atomic across
 * concurrent writers. The validator catches resulting forks.
 */
export async function recordAuditEvent(
  db: Database,
  input: RecordAuditEventInput,
): Promise<AuditEventRow> {
  const now = input.now ?? new Date();
  const prev = await db
    .select({ rowHash: auditEvents.rowHash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(1);
  const prevHash = prev[0]?.rowHash ?? AUDIT_EVENTS_GENESIS_HASH;

  const id = crypto.randomUUID();
  const recorded: RecordedFields = {
    id,
    createdAt: now,
    action: input.action,
    entityKind: input.entityKind,
    entityId: input.entityId,
    actorUserId: input.actorUserId ?? null,
    payload: input.payload ?? {},
  };
  const rowHash = computeAuditRowHash(prevHash, recorded);

  const [row] = await db
    .insert(auditEvents)
    .values({
      id,
      createdAt: now,
      action: recorded.action,
      entityKind: recorded.entityKind,
      entityId: recorded.entityId,
      actorUserId: recorded.actorUserId,
      payload: recorded.payload,
      prevHash,
      rowHash,
    })
    .returning();
  if (!row) throw new Error("audit_events insert returned no row");
  return row;
}

export interface ChainValidationOk {
  ok: true;
  rowsChecked: number;
}

export interface ChainValidationFail {
  ok: false;
  rowsChecked: number;
  brokenAt: AuditEventRow;
  reason: "prev-hash-mismatch" | "row-hash-mismatch" | "genesis-mismatch";
}

export type ChainValidationResult = ChainValidationOk | ChainValidationFail;

export async function validateAuditEventChain(db: Database): Promise<ChainValidationResult> {
  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));

  let expectedPrev = AUDIT_EVENTS_GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        rowsChecked: i + 1,
        brokenAt: row,
        reason: i === 0 ? "genesis-mismatch" : "prev-hash-mismatch",
      };
    }
    const recomputed = computeAuditRowHash(row.prevHash, {
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      entityKind: row.entityKind,
      entityId: row.entityId,
      actorUserId: row.actorUserId,
      payload: row.payload,
    });
    if (recomputed !== row.rowHash) {
      return {
        ok: false,
        rowsChecked: i + 1,
        brokenAt: row,
        reason: "row-hash-mismatch",
      };
    }
    expectedPrev = row.rowHash;
  }
  return { ok: true, rowsChecked: rows.length };
}
