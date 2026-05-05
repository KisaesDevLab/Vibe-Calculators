import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
import {
  authEvents,
  AUTH_EVENTS_GENESIS_HASH,
  type AuthEventKind,
  type AuthEventRow,
  type Database,
} from "@vibe-calc/db";

/**
 * Phase 2.8 — auth audit log writer + chain validator.
 *
 * Each row carries:
 *   prev_hash : the row_hash of the immediately preceding row, or
 *               AUTH_EVENTS_GENESIS_HASH for the very first row.
 *   row_hash  : SHA-256 of (prev_hash || canonical(row)) — covers
 *               every column except row_hash itself.
 *
 * Tampering with any column forces a re-hash that breaks the chain
 * downstream; the validator function detects this. Rows are
 * intentionally never updated; the model is insert-only.
 */

interface RecordedFields {
  id: string;
  createdAt: Date;
  kind: AuthEventKind;
  userId: string | null;
  actorUserId: string | null;
  ip: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
}

/**
 * Canonical serialization for hashing. JSON.stringify with
 * deterministic key ordering (alphabetical) so two runs over the
 * same logical row produce the same digest.
 */
function canonicalize(fields: RecordedFields): string {
  const ordered = {
    actorUserId: fields.actorUserId,
    createdAt: fields.createdAt.toISOString(),
    id: fields.id,
    ip: fields.ip,
    kind: fields.kind,
    payload: sortKeys(fields.payload),
    userAgent: fields.userAgent,
    userId: fields.userId,
  };
  return JSON.stringify(ordered);
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

export function computeRowHash(prevHash: string, fields: RecordedFields): string {
  return createHash("sha256")
    .update(prevHash)
    .update("|")
    .update(canonicalize(fields))
    .digest("hex");
}

export interface RecordAuthEventInput {
  kind: AuthEventKind;
  userId?: string | undefined;
  actorUserId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  payload?: Record<string, unknown>;
  /** Override clock for tests. */
  now?: Date;
}

/**
 * Append a row to auth_events. Reads the most recent row's hash to
 * use as prev_hash, or the genesis sentinel if the table is empty.
 *
 * NOT atomic across concurrent writers — a race between two callers
 * can produce two rows with the same prev_hash. The chain validator
 * detects this. For the auth flows we care about (low write rate,
 * one row per request) it's acceptable; Phase 21 may upgrade to a
 * SERIALIZABLE-isolated transaction or an advisory lock.
 */
// Distinct from the audit_events lock key — these are independent
// chains and shouldn't serialize against each other.
const AUTH_CHAIN_LOCK_KEY = 770000002;

export async function recordAuthEvent(
  db: Database,
  input: RecordAuthEventInput,
): Promise<AuthEventRow> {
  const now = input.now ?? new Date();
  // Hold the chain lock for read-prev → insert. Two concurrent
  // failed-login attempts on the same (ip, email) would otherwise
  // both read the same prev_hash and fork the chain.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUTH_CHAIN_LOCK_KEY})`);
    const prev = await tx
      .select({ rowHash: authEvents.rowHash })
      .from(authEvents)
      .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
      .limit(1);

    const prevHash = prev[0]?.rowHash ?? AUTH_EVENTS_GENESIS_HASH;

    const id = generateUuidV4();
    const recorded: RecordedFields = {
      id,
      createdAt: now,
      kind: input.kind,
      userId: input.userId ?? null,
      actorUserId: input.actorUserId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      payload: input.payload ?? {},
    };

    const rowHash = computeRowHash(prevHash, recorded);

    const [row] = await tx
      .insert(authEvents)
      .values({
        id,
        createdAt: now,
        kind: recorded.kind,
        userId: recorded.userId,
        actorUserId: recorded.actorUserId,
        ip: recorded.ip,
        userAgent: recorded.userAgent,
        payload: recorded.payload,
        prevHash,
        rowHash,
      })
      .returning();

    if (!row) throw new Error("auth_events insert returned no row");
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
  brokenAt: AuthEventRow;
  reason: "prev-hash-mismatch" | "row-hash-mismatch" | "genesis-mismatch";
}

export type ChainValidationResult = ChainValidationOk | ChainValidationFail;

/**
 * Walks the entire auth_events table in time order and verifies the
 * chain. Returns the first broken row and the failure mode, or
 * { ok: true } if the chain is intact.
 */
export async function validateAuthEventChain(db: Database): Promise<ChainValidationResult> {
  const rows = await db
    .select()
    .from(authEvents)
    .orderBy(asc(authEvents.createdAt), asc(authEvents.id));

  let expectedPrev = AUTH_EVENTS_GENESIS_HASH;
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
    const recomputed = computeRowHash(row.prevHash, {
      id: row.id,
      createdAt: row.createdAt,
      kind: row.kind,
      userId: row.userId,
      actorUserId: row.actorUserId,
      ip: row.ip,
      userAgent: row.userAgent,
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

// uuid v4 generated locally so the hash uses the same value the row
// will carry; we can't rely on the DB DEFAULT because we hash before
// the INSERT.
function generateUuidV4(): string {
  // crypto.randomUUID is in Node 19+, available in our Node 20.
  return crypto.randomUUID();
}
