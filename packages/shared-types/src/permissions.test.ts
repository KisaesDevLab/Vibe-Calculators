import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PermissionSchema,
  ROLES,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  RoleSchema,
  permissionsFor,
  roleAtLeast,
  roleHasPermission,
  type Permission,
  type Role,
} from "./permissions";

describe("permission matrix", () => {
  it("exports the four build-plan roles", () => {
    expect([...ROLES].sort()).toEqual(["admin", "preparer", "readonly", "reviewer"]);
  });

  it("Zod schema mirrors the const list", () => {
    expect(RoleSchema.options).toEqual(ROLES);
    expect(PermissionSchema.options).toEqual(PERMISSIONS);
  });

  it("admin holds every defined permission", () => {
    for (const p of PERMISSIONS) {
      expect(roleHasPermission("admin", p)).toBe(true);
    }
  });

  it("readonly cannot mutate anything", () => {
    const mutating: Permission[] = [
      "client:create",
      "client:update",
      "calculation:create",
      "calculation:update",
      "calculation:approve",
      "user:invite",
      "audit:read",
      "settings:write",
    ];
    for (const p of mutating) {
      expect(roleHasPermission("readonly", p)).toBe(false);
    }
  });

  it("readonly can read clients/engagements/calculations + download exports", () => {
    expect(roleHasPermission("readonly", "client:read")).toBe(true);
    expect(roleHasPermission("readonly", "engagement:read")).toBe(true);
    expect(roleHasPermission("readonly", "calculation:read")).toBe(true);
    expect(roleHasPermission("readonly", "export:download")).toBe(true);
  });

  it("preparer can submit-for-review but not approve", () => {
    expect(roleHasPermission("preparer", "calculation:submit-for-review")).toBe(true);
    expect(roleHasPermission("preparer", "calculation:approve")).toBe(false);
    expect(roleHasPermission("preparer", "calculation:reject")).toBe(false);
  });

  it("reviewer inherits every preparer permission and adds approve/reject", () => {
    for (const p of permissionsFor("preparer")) {
      expect(roleHasPermission("reviewer", p)).toBe(true);
    }
    expect(roleHasPermission("reviewer", "calculation:approve")).toBe(true);
    expect(roleHasPermission("reviewer", "calculation:reject")).toBe(true);
  });

  it("only admin can manage users / read audit / configure AI / restore", () => {
    const adminOnly: Permission[] = [
      "user:invite",
      "user:suspend",
      "user:reset-password",
      "user:require-2fa",
      "user:list",
      "user:clear-lockout",
      "audit:read",
      "settings:write",
      "ai:configure",
      "backup:create",
      "backup:restore",
    ];
    for (const p of adminOnly) {
      expect(roleHasPermission("admin", p)).toBe(true);
      for (const r of ["readonly", "preparer", "reviewer"] as Role[]) {
        expect(roleHasPermission(r, p)).toBe(false);
      }
    }
  });

  it("role rank is strictly increasing readonly < preparer < reviewer < admin", () => {
    expect(ROLE_RANK.readonly).toBeLessThan(ROLE_RANK.preparer);
    expect(ROLE_RANK.preparer).toBeLessThan(ROLE_RANK.reviewer);
    expect(ROLE_RANK.reviewer).toBeLessThan(ROLE_RANK.admin);
  });

  it("roleAtLeast handles every (role, threshold) pair correctly", () => {
    expect(roleAtLeast("admin", "readonly")).toBe(true);
    expect(roleAtLeast("readonly", "admin")).toBe(false);
    expect(roleAtLeast("preparer", "preparer")).toBe(true);
    expect(roleAtLeast("reviewer", "preparer")).toBe(true);
    expect(roleAtLeast("preparer", "reviewer")).toBe(false);
  });

  it("permissionsFor returns deterministic sorted output", () => {
    const a = permissionsFor("preparer");
    const b = permissionsFor("preparer");
    expect(a).toEqual(b);
    expect([...a]).toEqual([...a].sort());
  });

  it("ROLE_PERMISSIONS exposes ReadonlySet at the type level", () => {
    // Compile-time assertion only — Set is mutable at runtime, but
    // the public type forbids .add() so consumers can't accidentally
    // alter the matrix at runtime.
    const perms = ROLE_PERMISSIONS.readonly;
    // @ts-expect-error — readonly set has no .add at the type level
    void perms.add;
    expect(perms.has("client:read")).toBe(true);
  });
});
