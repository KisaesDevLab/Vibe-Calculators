import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { users, type AuthEventKind, type Database, type UserRow } from "@vibe-calc/db";
import { ROLES, RoleSchema, type Role } from "@vibe-calc/shared-types";
import type {
  AuditEvent,
  AuditSink,
  CreateLocalUserInput,
  CreateUserInput,
  RoleVocabulary,
  UserAdapter,
  VibeUser,
} from "@kisaesdevlab/vibe-auth";
import { recordAuthEvent } from "./auth-events.js";
import { hashPassword } from "./password.js";
import { revokeAllUserSessions } from "./sessions.js";

/**
 * Single sign-on — the product side of the @kisaesdevlab/vibe-auth user
 * contract. Shared by the API (lib/vibeAuth.ts) and the break-glass CLI
 * adapter (vibeAuthAdapter.ts), so it depends on nothing but the DB.
 */

/** The IdP groups map to role slugs only; nothing else about a user is synced. */
export const VIBE_CALC_ROLES: RoleVocabulary = {
  roles: ROLES,
  adminRole: "admin",
  // Explicit on purpose: the package's own default matches case-sensitively
  // and falls back to the LEAST privileged role.
  defaultRoleMap: {
    "vibe-admin": "admin",
    "vibe-it": "admin",
    "vibe-partner": "admin",
    "vibe-manager": "reviewer",
    "vibe-staff": "preparer",
  },
};

export const DEFAULT_BREAKGLASS_USERNAME = "vibe-breakglass";

/**
 * Users here are keyed by email and the users_email_format CHECK needs
 * an '@', so the break-glass username is stored under this address. A
 * dotted domain, never `@localhost`: the login body validates emails.
 * The mailbox does not exist — magic links can never reach it.
 */
export const BREAKGLASS_EMAIL = "vibe-breakglass@vibe-calculators.local";

export function breakglassUsername(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VIBE_BREAKGLASS_USERNAME?.trim() || DEFAULT_BREAKGLASS_USERNAME).toLowerCase();
}

/**
 * A `pending` user (invited, never signed in) counts as active: the
 * first magic-link consume activates such a row, and a verified-email
 * SSO sign-in proves the same mailbox.
 */
function isActive(row: Pick<UserRow, "status" | "archivedAt">): boolean {
  return row.status !== "suspended" && row.archivedAt === null;
}

function toVibeUser(row: UserRow): VibeUser {
  const local = row.email === BREAKGLASS_EMAIL;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: isActive(row),
    local,
    ...(local ? { username: breakglassUsername() } : {}),
  };
}

export interface VibeUsersOptions {
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

export function createVibeUsers(db: Database, opts: VibeUsersOptions = {}): UserAdapter {
  const warn = opts.warn ?? (() => undefined);

  async function byEmail(email: string): Promise<UserRow | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    return row ?? null;
  }

  return {
    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? toVibeUser(row) : null;
    },

    async findByEmail(email) {
      const row = await byEmail(email);
      return row ? toVibeUser(row) : null;
    },

    async findByUsername(username) {
      const u = username.trim().toLowerCase();
      const row = await byEmail(u === breakglassUsername() ? BREAKGLASS_EMAIL : u);
      return row ? toVibeUser(row) : null;
    },

    /**
     * JIT provisioning. No password (the login route already refuses a
     * NULL hash) and never must_change_password — the SPA gate would
     * trap a user who has no password to change.
     */
    async create(input: CreateUserInput) {
      const email = input.email.trim().toLowerCase();
      const [row] = await db
        .insert(users)
        .values({
          email,
          name: input.name?.trim() || email.split("@")[0] || email,
          role: RoleSchema.parse(input.role),
          status: "active",
          passwordHash: null,
          mustChangePassword: false,
        })
        .returning();
      if (!row) throw new Error("users insert returned no row");
      return toVibeUser(row);
    },

    /**
     * Role sync from IdP groups. Refuses to demote the last active admin
     * (the break-glass row does not count as another admin): a mis-mapped
     * group on the first SSO link must not lock the firm out of settings.
     */
    async setRole(userId, role) {
      const next: Role = RoleSchema.parse(role);
      const [current] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!current || current.role === next) return;
      if (current.role === "admin") {
        const [others] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.role, "admin"),
              eq(users.status, "active"),
              isNull(users.archivedAt),
              ne(users.id, userId),
              ne(users.email, BREAKGLASS_EMAIL),
            ),
          );
        if ((others?.n ?? 0) === 0) {
          warn("vibe-auth: role sync skipped — would demote the last active admin", {
            userId,
            wanted: next,
          });
          return;
        }
      }
      await db.update(users).set({ role: next, updatedAt: new Date() }).where(eq(users.id, userId));
    },

    /**
     * Break-glass provisioning. The row must be able to sign in during an
     * IdP outage: active, Argon2id password, no forced-change flag.
     */
    async createLocalUser(input: CreateLocalUserInput) {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email.trim().toLowerCase(),
          name: input.name,
          role: RoleSchema.parse(input.role),
          status: "active",
          passwordHash: await hashPassword(input.password),
          mustChangePassword: false,
        })
        .returning();
      if (!row) throw new Error("users insert returned no row");
      return toVibeUser(row);
    },

    async setLocalPassword(userId, password) {
      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await revokeAllUserSessions(db, userId);
    },

    async setActive(userId, active) {
      await db
        .update(users)
        .set(
          active
            ? { status: "active", archivedAt: null, updatedAt: new Date() }
            : { status: "suspended", updatedAt: new Date() },
        )
        .where(eq(users.id, userId));
      if (!active) await revokeAllUserSessions(db, userId);
    },
  };
}

/** Events whose `actor` is a signed-in admin's user id (the CLI passes "cli"). */
const ACTOR_IS_USER = new Set<AuditEvent["type"]>([
  "vibe.auth.settings.changed",
  "vibe.auth.mode.changed",
  "vibe.auth.mfa.enforcement.disabled",
]);

/**
 * Package audit events → the tamper-evident auth_events chain. Never
 * throws: a failed audit write must not fail the sign-in it describes.
 */
export function createVibeAuditSink(db: Database, opts: VibeUsersOptions = {}): AuditSink {
  const warn = opts.warn ?? (() => undefined);
  return {
    async emit(event) {
      const { type, at: _at, user_id, actor, ip, ua, ...rest } = event;
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      try {
        await recordAuthEvent(db, {
          kind: type satisfies AuthEventKind,
          userId: str(user_id),
          actorUserId: ACTOR_IS_USER.has(type) ? str(actor) : undefined,
          ip: str(ip),
          userAgent: str(ua)?.slice(0, 512),
          payload: { ...rest, ...(actor !== undefined ? { actor } : {}) },
        });
      } catch (err) {
        warn("vibe-auth: audit write failed", {
          type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
