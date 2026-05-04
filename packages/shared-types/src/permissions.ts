import { z } from "zod";

/**
 * Permission matrix — the single source of truth for "which role can
 * do what" across the entire application.
 *
 * Per CLAUDE.md (load-bearing convention "Permissions go through
 * middleware") *every* permission check — backend route, frontend
 * component, queue worker — calls one of the helpers below or the
 * Express middleware in apps/api/src/middleware/auth.ts that wraps
 * them. Inline `if (user.role === "admin")` checks are a CI-flagged
 * anti-pattern.
 *
 * Adding a permission here is the cheap part; the expensive part is
 * the test that asserts every route enforces it (see
 * apps/api/src/routes/__route-coverage.test.ts when Phase 24 lands).
 */

// ---------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------

export const ROLES = ["admin", "reviewer", "preparer", "readonly"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Role rank — higher number = more privileges. Used by helpers that
 * want "at least this role". Permission membership is still the
 * primary mechanism; this exists for cases like seniority comparisons
 * (preparer cannot approve their own submission, etc).
 */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  readonly: 0,
  preparer: 1,
  reviewer: 2,
  admin: 3,
};

// ---------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------

export const PERMISSIONS = [
  // User administration
  "user:list",
  "user:invite",
  "user:suspend",
  "user:reset-password",
  "user:require-2fa",
  "user:clear-lockout",

  // Client / engagement / calculation CRUD
  "client:read",
  "client:create",
  "client:update",
  "client:archive",
  "engagement:read",
  "engagement:create",
  "engagement:update",
  "engagement:archive",
  "engagement:assign",
  "calculation:read",
  "calculation:create",
  "calculation:update",
  "calculation:archive",

  // Review workflow
  "calculation:submit-for-review",
  "calculation:approve",
  "calculation:reject",

  // Reporting / export
  "export:create",
  "export:download",
  "email:send",

  // Audit / settings
  "audit:read",
  "settings:read",
  "settings:write",

  // AI extraction (Phase 23)
  "ai:configure",
  "ai:use",

  // Backup / restore (Phase 25)
  "backup:create",
  "backup:restore",
] as const;

export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

// ---------------------------------------------------------------------
// Role → permissions
// ---------------------------------------------------------------------

const READONLY_PERMS: readonly Permission[] = [
  "client:read",
  "engagement:read",
  "calculation:read",
  "export:download",
];

const PREPARER_PERMS: readonly Permission[] = [
  ...READONLY_PERMS,
  "client:create",
  "client:update",
  "client:archive",
  "engagement:create",
  "engagement:update",
  "engagement:archive",
  "calculation:create",
  "calculation:update",
  "calculation:archive",
  "calculation:submit-for-review",
  "export:create",
  "email:send",
  "ai:use",
];

const REVIEWER_PERMS: readonly Permission[] = [
  ...PREPARER_PERMS,
  "engagement:assign",
  "calculation:approve",
  "calculation:reject",
];

const ADMIN_PERMS: readonly Permission[] = [...PERMISSIONS];

/**
 * The matrix proper. Each role's permission set is a frozen Set built
 * from the role-tier helpers above so addition of a new permission
 * automatically applies to every role that ought to inherit it.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  readonly: new Set(READONLY_PERMS),
  preparer: new Set(PREPARER_PERMS),
  reviewer: new Set(REVIEWER_PERMS),
  admin: new Set(ADMIN_PERMS),
};

// ---------------------------------------------------------------------
// Helpers — these are the public API consumers should use.
// ---------------------------------------------------------------------

/** True iff the role grants the permission. */
export function roleHasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(perm);
}

/** True iff `role` is at least as senior as `threshold`. */
export function roleAtLeast(role: Role, threshold: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[threshold];
}

/** Returns every permission granted to a role, sorted (deterministic). */
export function permissionsFor(role: Role): readonly Permission[] {
  return [...ROLE_PERMISSIONS[role]].sort();
}
