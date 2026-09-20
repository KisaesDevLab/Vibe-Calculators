/**
 * Adapter module for the `vibe-auth` CLI (break-glass account management).
 * package.json → "vibeAuth": { "adapter": "./dist/vibeAuthAdapter.js" }
 * points the CLI here; it resolves both from the working directory.
 *
 * The runtime image is distroless (no shell, no npx), so the Appliance
 * console runs the CLI by its module path from WORKDIR /app:
 *
 *   /nodejs/bin/node node_modules/@kisaesdevlab/vibe-auth/dist/cli.js \
 *     breakglass ensure|rotate|status --json
 *
 * Own process, same env as the server. Only DATABASE_URL is needed — no
 * loadEnv(), so a status check works even when other config is broken.
 */
import { createDatabase } from "@vibe-calc/db";
import type { VibeAuthCliAdapter } from "@kisaesdevlab/vibe-auth";
import {
  BREAKGLASS_EMAIL,
  VIBE_CALC_ROLES,
  createVibeAuditSink,
  createVibeUsers,
} from "./lib/vibeAuthUsers.js";

export default async function vibeAuthAdapter(): Promise<VibeAuthCliAdapter> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const { db, pool } = createDatabase({ connectionString });
  const warn = (msg: string, meta?: Record<string, unknown>) =>
    process.stderr.write(`${msg} ${JSON.stringify(meta ?? {})}\n`);
  return {
    users: createVibeUsers(db, { warn }),
    audit: createVibeAuditSink(db, { warn }),
    adminRole: VIBE_CALC_ROLES.adminRole,
    breakglassEmail: BREAKGLASS_EMAIL,
    close: () => pool.end(),
  };
}
