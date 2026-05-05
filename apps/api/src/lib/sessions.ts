import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { sessions, users, type Database, type SessionRow, type UserRow } from "@vibe-calc/db";

/**
 * Phase 2.4 — server-side session store.
 *
 * Cookies carry an opaque 32-byte hex session id; all metadata
 * (user, expirations, last-seen, ip, ua) lives in the sessions
 * table so revoking is a row update.
 *
 * Two expirations per session:
 *   - expires_at          — rolling. Bumped on every authenticated
 *                           request (extendSession). When it passes,
 *                           the cookie is treated as expired.
 *   - absolute_expires_at — set once at creation, never bumped. Caps
 *                           total session lifetime regardless of
 *                           activity. The build plan calls for 30-day
 *                           rolling / 90-day absolute.
 *
 * Both are checked at lookup; the lower of the two wins.
 */

export const SESSION_COOKIE_NAME = "vibecalc_sid";
export const ROLLING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_ID_BYTES = 32;

/** Cryptographically random opaque session id (64 hex chars). */
export function generateSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString("hex");
}

export interface CreateSessionInput {
  userId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  /** Override clock for tests. */
  now?: Date;
}

export async function createSession(db: Database, input: CreateSessionInput): Promise<SessionRow> {
  const now = input.now ?? new Date();
  const id = generateSessionId();
  const [row] = await db
    .insert(sessions)
    .values({
      id,
      userId: input.userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ROLLING_TTL_MS),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_TTL_MS),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning();
  if (!row) throw new Error("Session insert returned no row");
  return row;
}

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
}

/**
 * Looks up a session by its cookie ID. Returns null if the session
 * is missing, revoked, expired (either window), or belongs to a
 * suspended/archived user.
 */
export async function resolveSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
        isNull(users.archivedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.user.status === "suspended") return null;
  return { session: row.session, user: row.user };
}

/**
 * Bump a session's `last_seen_at` and rolling `expires_at`. The
 * absolute window is never extended. No-op for idle requests within
 * the past minute (avoids a write per static asset hit).
 */
export async function extendSession(
  db: Database,
  current: SessionRow,
  now: Date = new Date(),
  refreshIfOlderThanMs = 60_000,
): Promise<SessionRow> {
  if (now.getTime() - current.lastSeenAt.getTime() < refreshIfOlderThanMs) {
    return current;
  }
  const newExpiresAt = new Date(
    Math.min(now.getTime() + ROLLING_TTL_MS, current.absoluteExpiresAt.getTime()),
  );
  const [row] = await db
    .update(sessions)
    .set({ lastSeenAt: now, expiresAt: newExpiresAt })
    .where(eq(sessions.id, current.id))
    .returning();
  return row ?? current;
}

export async function revokeSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sessionId));
}

export async function revokeAllUserSessions(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Revoke every session for the user EXCEPT one specified id. Used by
 * password-change to invalidate all peer browsers without forcing the
 * caller to re-log-in on their current tab.
 */
export async function revokeOtherUserSessions(
  db: Database,
  userId: string,
  keepSessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        // ne(...) — drizzle doesn't have a `ne` helper imported here, so
        // express via sql.
        sql`${sessions.id} != ${keepSessionId}`,
      ),
    );
}

export async function listActiveSessionsForUser(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
    );
}

/** Periodic cleanup helper — Phase 22's cron will call this. */
export async function purgeExpiredSessions(db: Database, now: Date = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.absoluteExpiresAt, now));
}
