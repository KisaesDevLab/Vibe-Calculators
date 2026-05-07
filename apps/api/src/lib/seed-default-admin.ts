import { count } from "drizzle-orm";
import { users, type Database } from "@vibe-calc/db";
import { hashPassword } from "./password.js";
import { recordAuthEvent } from "./auth-events.js";

/**
 * Phase 25.3 (revised) — first-run default-admin seeder.
 *
 * Replaces the bootstrap-token install ceremony. On API boot, if the
 * users table is empty, insert a single admin row with a well-known
 * default password and `must_change_password=true`. The login + /me
 * payloads carry the flag through to the SPA, which gates every
 * route behind /onboarding/change-password until the operator picks
 * a real password.
 *
 * The default password intentionally bypasses validatePasswordPolicy:
 * the policy enforces user-chosen passwords, and we want a memorable
 * literal that the operator types once and immediately changes. The
 * forced-change endpoint runs the full policy on the new value.
 */

export const DEFAULT_ADMIN_EMAIL = "admin@local.test";
export const DEFAULT_ADMIN_NAME = "Admin";
export const DEFAULT_ADMIN_PASSWORD = "vibe-admin-changeme";

export interface SeedResult {
  seeded: boolean;
  userId?: string;
}

export async function seedDefaultAdminIfEmpty(db: Database): Promise<SeedResult> {
  const [row] = await db.select({ n: count() }).from(users);
  if (Number(row?.n ?? 0) > 0) return { seeded: false };

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  const [created] = await db
    .insert(users)
    .values({
      email: DEFAULT_ADMIN_EMAIL,
      name: DEFAULT_ADMIN_NAME,
      passwordHash,
      role: "admin",
      status: "active",
      mustChangePassword: true,
    })
    .returning({ id: users.id });
  if (!created) throw new Error("default-admin seed insert returned no row");

  await recordAuthEvent(db, {
    kind: "bootstrap.first_admin",
    userId: created.id,
    payload: { email: DEFAULT_ADMIN_EMAIL, source: "default-seed" },
  });

  return { seeded: true, userId: created.id };
}

export function printDefaultAdminBanner(print: (s: string) => void = console.error): void {
  const line = "─".repeat(72);
  print(`\n${line}`);
  print(`Vibe Calculators — first-run default admin seeded`);
  print(line);
  print(`Sign in at /login with:`);
  print(``);
  print(`  email:    ${DEFAULT_ADMIN_EMAIL}`);
  print(`  password: ${DEFAULT_ADMIN_PASSWORD}`);
  print(``);
  print(`You will be required to set a new password before anything else.`);
  print(`${line}\n`);
}
