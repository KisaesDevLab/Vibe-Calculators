import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
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

/**
 * Recursive deterministic canonicalization for hash inputs.
 *
 * - Object keys sorted alphabetically.
 * - Date values rendered as ISO 8601 (lossless).
 * - undefined values dropped (matches JSON.stringify default).
 *
 * Future schema additions auto-propagate into the hash because the
 * canonicalizer walks every key it sees, rather than a hand-curated
 * field allowlist (which the old implementation used and which would
 * silently miss new columns).
 */
function canonicalizeValue(input: unknown): unknown {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) return input.map(canonicalizeValue);
  if (typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      const canon = canonicalizeValue(v);
      if (canon !== undefined) out[k] = canon;
    }
    return out;
  }
  return input;
}

/**
 * Canonical JSON over the recorded-row shape (everything except
 * `rowHash` and `prevHash`, which are derived from this canonical
 * form). The function accepts any record so it can be reused by the
 * auth-events writer too.
 */
function canonicalizeRow(row: Record<string, unknown>): string {
  const excluded = new Set(["rowHash", "prevHash", "row_hash", "prev_hash"]);
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (excluded.has(k)) continue;
    filtered[k] = v;
  }
  return JSON.stringify(canonicalizeValue(filtered));
}

function canonicalize(fields: RecordedFields): string {
  // Reuse the generic walker via a record cast — the
  // RecordedFields shape is keyed identically to the row columns
  // it persists.
  return canonicalizeRow(fields as unknown as Record<string, unknown>);
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
// Stable advisory-lock key for the audit_events chain. The number
// is arbitrary but must be unique across all `pg_advisory_xact_lock`
// callers in this codebase. Picked from a high range to avoid
// collisions with extension-supplied locks.
const AUDIT_CHAIN_LOCK_KEY = 770000001;

export async function recordAuditEvent(
  db: Database,
  input: RecordAuditEventInput,
): Promise<AuditEventRow> {
  const now = input.now ?? new Date();
  // Hold the chain lock for the duration of read-prev → insert. Two
  // concurrent writers serialize through the advisory lock; the
  // second waits until the first commits. Per Postgres docs,
  // pg_advisory_xact_lock is released automatically at tx end.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);
    const prev = await tx
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

    const [row] = await tx
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
  });
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

/**
 * Walks audit_events in time order and verifies the prev_hash chain.
 *
 * **Concurrent-writer caveat**: the writer (`recordAuditEvent`) reads
 * the latest row's hash and inserts non-atomically. Two parallel writes
 * can both read the same `prev_hash` and both insert with it — a fork.
 * The validator detects this as `prev-hash-mismatch` on the second row
 * forward, which is reported as tampering even though it's a benign
 * race. Resolution requires either a `SERIALIZABLE` transaction or a
 * Postgres advisory lock; tracked as a Phase 21 follow-up.
 *
 * If you see `prev-hash-mismatch` on a fresh chain with no actual
 * tampering, suspect a concurrent-writer fork rather than a malicious
 * actor.
 */
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
