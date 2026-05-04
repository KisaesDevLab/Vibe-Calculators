import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { users, userRoleEnum, userStatusEnum } from "./users";
import { sessions } from "./sessions";
import { passwordResetTokens } from "./password-reset-tokens";
import { magicLinkTokens } from "./magic-link-tokens";

describe("users schema", () => {
  it("uses table name 'users'", () => {
    expect(getTableName(users)).toBe("users");
  });

  it("declares the build-plan columns", () => {
    const cols = getTableColumns(users);
    expect(Object.keys(cols).sort()).toEqual(
      [
        "archivedAt",
        "createdAt",
        "email",
        "id",
        "lastLoginAt",
        "name",
        "passwordHash",
        "role",
        "status",
        "totpEnabled",
        "totpSecret",
        "updatedAt",
      ].sort(),
    );
  });

  it("makes password_hash nullable (magic-link-only users)", () => {
    expect(getTableColumns(users).passwordHash.notNull).toBe(false);
  });

  it("makes email NOT NULL", () => {
    expect(getTableColumns(users).email.notNull).toBe(true);
  });

  it("includes the four roles from the build plan", () => {
    expect([...userRoleEnum.enumValues].sort()).toEqual(
      ["admin", "preparer", "readonly", "reviewer"].sort(),
    );
  });

  it("includes the three lifecycle statuses", () => {
    expect([...userStatusEnum.enumValues].sort()).toEqual(
      ["active", "pending", "suspended"].sort(),
    );
  });
});

describe("sessions schema", () => {
  it("declares both rolling and absolute expirations", () => {
    const cols = getTableColumns(sessions);
    expect(cols.expiresAt.notNull).toBe(true);
    expect(cols.absoluteExpiresAt.notNull).toBe(true);
  });

  it("captures ip + user_agent (nullable)", () => {
    const cols = getTableColumns(sessions);
    expect(cols.ip.notNull).toBe(false);
    expect(cols.userAgent.notNull).toBe(false);
  });

  it("references users via FK", () => {
    const cols = getTableColumns(sessions);
    expect(cols.userId.notNull).toBe(true);
  });
});

describe("password_reset_tokens schema", () => {
  it("uses token_hash as the primary key (raw token never stored)", () => {
    const cols = getTableColumns(passwordResetTokens);
    expect(cols.tokenHash.primary).toBe(true);
  });

  it("tracks consumption for one-time-use enforcement", () => {
    const cols = getTableColumns(passwordResetTokens);
    expect(cols.consumedAt.notNull).toBe(false);
    expect(cols.expiresAt.notNull).toBe(true);
  });
});

describe("magic_link_tokens schema", () => {
  it("uses token_hash as the primary key", () => {
    expect(getTableColumns(magicLinkTokens).tokenHash.primary).toBe(true);
  });

  it("requires ip_bound (build plan §2.6 IP-bound)", () => {
    expect(getTableColumns(magicLinkTokens).ipBound.notNull).toBe(true);
  });
});
