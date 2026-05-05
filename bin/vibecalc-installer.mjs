#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Phase 25.5 — vibecalc-installer CLI
//
// Single-file Node ESM script. No external dependencies — uses only
// Node 18+ stdlib so an operator can `curl -O` this file, `chmod +x`,
// and run it on a clean Ubuntu 24.04 box with nothing more than
// Docker + Node installed. (For Windows we recommend running it via
// WSL2 or by invoking `node vibecalc-installer.mjs <command>`.)
//
// Subcommands (matches the build plan §25.5 contract):
//
//   install   — first-run setup: writes .env from prompts, pulls
//               images, runs migrations, prints the bootstrap URL.
//   upgrade   — pulls newer images, runs pending migrations, restarts.
//   uninstall — stops the stack and (with --purge) removes named
//               volumes. Refuses to purge without --i-know.
//   status    — `docker compose ps` + the /api/health summary.
//   mode      — switches VIBE_DEPLOY_MODE between lan/domain/tailscale.
//   doctor    — same checks as `just doctor` plus a fresh probe.
//   backup    — invokes `just backup` (or the equivalent compose call).
//   restore   — invokes `just restore <path>`.
//
// All commands are idempotent where possible. `install` will refuse
// to overwrite an existing .env unless given --force.

import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const SCRIPT = fileURLToPath(import.meta.url);
const DEFAULT_REPO_DIR = process.env.VIBE_REPO_DIR ?? resolve(dirname(SCRIPT), "..");

const COMMANDS = {
  install: cmdInstall,
  upgrade: cmdUpgrade,
  uninstall: cmdUninstall,
  status: cmdStatus,
  mode: cmdMode,
  doctor: cmdDoctor,
  backup: cmdBackup,
  restore: cmdRestore,
  help: cmdHelp,
  "--help": cmdHelp,
  "-h": cmdHelp,
  "--version": () => {
    console.log(`vibecalc-installer ${VERSION}`);
    return 0;
  },
};

const args = process.argv.slice(2);
const subcommand = args[0] ?? "help";
const subArgs = args.slice(1);
const handler = COMMANDS[subcommand];
if (!handler) {
  console.error(`Unknown command: ${subcommand}`);
  cmdHelp();
  process.exit(2);
}
try {
  const code = await handler(subArgs);
  process.exit(code ?? 0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ---------------------------------------------------------------------
// Subcommand implementations
// ---------------------------------------------------------------------

async function cmdHelp() {
  console.log(`vibecalc-installer ${VERSION}

USAGE
  vibecalc-installer <command> [options]

COMMANDS
  install      First-run setup. Writes .env, pulls images, migrates DB.
  upgrade      Pull newer images, run migrations, restart.
  uninstall    Stop the stack. --purge removes named volumes (DESTRUCTIVE).
  status       Show container status + API health.
  mode <m>     Switch deploy mode: lan | domain | tailscale.
  doctor       Run health probes against the running stack.
  backup       Snapshot DB + uploads to ./backups/.
  restore <p>  Restore from a backup directory (DESTRUCTIVE).

ENVIRONMENT
  VIBE_REPO_DIR   Path to the repo (default: directory of this script).

EXAMPLES
  vibecalc-installer install
  vibecalc-installer upgrade
  vibecalc-installer uninstall --purge --i-know
  vibecalc-installer mode tailscale
  vibecalc-installer backup
  vibecalc-installer restore ./backups/20260101T120000Z
`);
  return 0;
}

async function cmdInstall(opts) {
  const force = opts.includes("--force");
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  const envPath = join(repoDir, ".env");
  if (existsSync(envPath) && !force) {
    console.log(`.env already exists at ${envPath}. Use --force to overwrite.`);
  } else {
    const rl = createInterface({ input, output });
    try {
      console.log("\n=== Vibe Calculators first-run installer ===\n");
      const firmName = await rl.question("Firm name: ");
      const adminEmail = await rl.question("First-admin email: ");
      const deployMode =
        (await rl.question("Deploy mode [lan|domain|tailscale] (lan): ")).trim() || "lan";
      const domain = deployMode === "domain" ? await rl.question("Public domain (FQDN): ") : "";
      const tlsEmail = deployMode === "domain" ? await rl.question("ACME contact email: ") : "";
      const generated = generateEnvFile({
        firmName,
        adminEmail,
        deployMode,
        domain,
        tlsEmail,
        existing: readEnvIfPresent(envPath),
      });
      writeFileSync(envPath, generated, { mode: 0o600 });
      console.log(`\n.env written to ${envPath} (mode 0600).`);
    } finally {
      rl.close();
    }
  }

  console.log("\n→ docker compose pull");
  run("docker", ["compose", "pull"], repoDir);

  console.log("\n→ docker compose up -d --build");
  run("docker", ["compose", "up", "-d", "--build"], repoDir);

  console.log("\n→ Running database migrations");
  run(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "vibe-calculators-server",
      "/app/node_modules/@vibe-calc/db/dist/migrate.js",
    ],
    repoDir,
  );

  console.log("\n→ Issuing first-admin bootstrap token");
  const out = capture(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "vibe-calculators-server",
      "/app/node_modules/@vibe-calc/db/dist/bootstrap-cli.js",
    ],
    repoDir,
  );
  console.log(out.stdout);
  console.log("\nInstall complete. Open the URL above to set up the first admin user.");
  return 0;
}

async function cmdUpgrade() {
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  console.log("→ Pre-upgrade snapshot");
  await cmdBackup([]);
  console.log("→ docker compose pull");
  run("docker", ["compose", "pull"], repoDir);
  console.log("→ Running pending migrations");
  run(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "vibe-calculators-server",
      "/app/node_modules/@vibe-calc/db/dist/migrate.js",
    ],
    repoDir,
  );
  console.log("→ Restarting services");
  run("docker", ["compose", "up", "-d", "--no-build"], repoDir);
  console.log("Upgrade complete.");
  return 0;
}

async function cmdUninstall(opts) {
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  const purge = opts.includes("--purge");
  const confirmed = opts.includes("--i-know");
  if (purge && !confirmed) {
    console.error("--purge removes ALL data (DB + uploads + exports).");
    console.error("Pass --i-know to confirm. Aborting.");
    return 1;
  }
  if (purge) {
    console.log("→ docker compose down --volumes (DESTRUCTIVE)");
    run("docker", ["compose", "down", "--volumes"], repoDir);
  } else {
    console.log("→ docker compose down (preserves named volumes)");
    run("docker", ["compose", "down"], repoDir);
  }
  return 0;
}

async function cmdStatus() {
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  console.log("→ docker compose ps");
  run("docker", ["compose", "ps"], repoDir);
  console.log("\n→ /api/health");
  const port = readEnvIfPresent(join(repoDir, ".env")).VIBE_HTTP_PORT ?? "80";
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error(`health probe failed: ${err.message ?? err}`);
    return 1;
  }
  return 0;
}

async function cmdMode(args) {
  const mode = args[0];
  if (!["lan", "domain", "tailscale"].includes(mode ?? "")) {
    console.error("usage: vibecalc-installer mode <lan|domain|tailscale>");
    return 2;
  }
  const envPath = join(DEFAULT_REPO_DIR, ".env");
  if (!existsSync(envPath)) {
    console.error(".env not found — run `vibecalc-installer install` first.");
    return 1;
  }
  const env = readEnvIfPresent(envPath);
  env.VIBE_DEPLOY_MODE = mode;
  if (mode === "domain") {
    if (!env.VIBE_DOMAIN) {
      const rl = createInterface({ input, output });
      try {
        env.VIBE_DOMAIN = (await rl.question("Public domain (FQDN): ")).trim();
        if (!env.VIBE_TLS_EMAIL) {
          env.VIBE_TLS_EMAIL = (await rl.question("ACME contact email: ")).trim();
        }
      } finally {
        rl.close();
      }
    }
  }
  writeFileSync(envPath, serializeEnv(env), { mode: 0o600 });
  console.log(`Deploy mode set to ${mode}. Restart with: docker compose up -d`);
  return 0;
}

async function cmdDoctor() {
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  console.log("=== docker compose ps ===");
  run("docker", ["compose", "ps"], repoDir, { stdoutOk: true });
  const port = readEnvIfPresent(join(repoDir, ".env")).VIBE_HTTP_PORT ?? "80";
  console.log("\n=== /api/health ===");
  let healthy = false;
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    if (res.ok) {
      console.log(JSON.stringify(await res.json(), null, 2));
      healthy = true;
    } else {
      console.error(`health endpoint returned ${res.status}`);
    }
  } catch (err) {
    console.error(`health probe failed: ${err.message ?? err}`);
  }
  if (!healthy) return 1;
  console.log("\n=== /api/health/deep ===");
  try {
    const res = await fetch(`http://localhost:${port}/api/health/deep`);
    console.log(JSON.stringify(await res.json(), null, 2));
    if (!res.ok) return 1;
  } catch (err) {
    console.error(`deep health probe failed: ${err.message ?? err}`);
    return 1;
  }
  console.log("\nOK: every probe is green.");
  return 0;
}

async function cmdBackup() {
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  const env = readEnvIfPresent(join(repoDir, ".env"));
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  // Backups land in the `backups` Docker volume so the API container
  // (mount: /data/backups, ro) can list them for the restore wizard.
  // We also keep a host-side copy under ./backups/ for offsite sync.
  const hostOut = join(repoDir, "backups", ts);
  mkdirSync(hostOut, { recursive: true });
  const user = env.POSTGRES_USER ?? "vibecalculators";
  const db = env.POSTGRES_DB ?? "vibe_calculators_db";

  console.log(`→ pg_dump → ${hostOut}/pgdump.bin`);
  const dumpRes = spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "pg_dump", "-U", user, "-d", db, "-Fc"],
    { cwd: repoDir, encoding: "buffer" },
  );
  if (dumpRes.status !== 0) {
    throw new Error(`pg_dump failed: ${dumpRes.stderr?.toString() ?? "unknown"}`);
  }
  writeFileSync(join(hostOut, "pgdump.bin"), dumpRes.stdout);

  console.log(`→ tar /data → ${hostOut}/pdf-output.tgz`);
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${hostOut}:/out`,
      "-v",
      "vibe-calculators_pdf-output:/data",
      "alpine",
      "sh",
      "-c",
      "tar -C /data -czf /out/pdf-output.tgz .",
    ],
    repoDir,
  );

  const manifest = {
    version: env.VIBE_VERSION ?? "dev",
    createdAt: ts,
    postgresUser: user,
    postgresDb: db,
  };
  writeFileSync(join(hostOut, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`→ copy snapshot into vibe-calculators_backups volume`);
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${hostOut}:/in:ro`,
      "-v",
      "vibe-calculators_backups:/out",
      "alpine",
      "sh",
      "-c",
      `mkdir -p /out/${ts} && cp -a /in/. /out/${ts}/`,
    ],
    repoDir,
    { allowFail: true },
  );

  console.log(`Backup written to ${hostOut}`);
  return 0;
}

async function cmdRestore(args) {
  ensureDocker();
  const repoDir = DEFAULT_REPO_DIR;
  const path = args[0];
  if (!path) {
    console.error("usage: vibecalc-installer restore <path>");
    return 2;
  }
  if (!existsSync(join(path, "pgdump.bin")) || !existsSync(join(path, "pdf-output.tgz"))) {
    console.error(`backup at ${path} is missing pgdump.bin or pdf-output.tgz`);
    return 1;
  }
  if (!args.includes("--i-know")) {
    console.error("restore is DESTRUCTIVE — overwrites the live DB and exports volume.");
    console.error("Pass --i-know to confirm. Aborting.");
    return 1;
  }
  const env = readEnvIfPresent(join(repoDir, ".env"));
  const user = env.POSTGRES_USER ?? "vibecalculators";
  const db = env.POSTGRES_DB ?? "vibe_calculators_db";

  console.log("→ pg_restore");
  const restoreRes = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "-U",
      user,
      "-d",
      db,
      "--clean",
      "--if-exists",
    ],
    { cwd: repoDir, input: readFileSync(join(path, "pgdump.bin")), encoding: "buffer" },
  );
  if (restoreRes.status !== 0) {
    throw new Error(`pg_restore failed: ${restoreRes.stderr?.toString() ?? "unknown"}`);
  }

  console.log("→ extract pdf-output.tgz");
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${resolve(path)}:/in`,
      "-v",
      "vibe-calculators_pdf-output:/data",
      "alpine",
      "sh",
      "-c",
      "rm -rf /data/* && tar -C /data -xzf /in/pdf-output.tgz",
    ],
    repoDir,
  );
  console.log("Restore complete.");
  return 0;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function ensureDocker() {
  const r = spawnSync("docker", ["--version"], { encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error("Docker CLI not found on PATH. Install Docker Engine first.");
  }
}

function run(cmd, argv, cwd, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd, stdio: "inherit" });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")} exited ${r.status}`);
  }
  return r.status ?? 0;
}

function capture(cmd, argv, cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(" ")} exited ${r.status}: ${r.stderr ?? ""}`);
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function readEnvIfPresent(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function serializeEnv(obj) {
  return (
    Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

function generateEnvFile({ firmName, adminEmail, deployMode, domain, tlsEmail, existing }) {
  // Carry over any existing values; fill in defaults for the rest.
  const env = { ...existing };
  env.NODE_ENV ??= "production";
  env.PORT ??= "3000";
  env.LOG_LEVEL ??= "info";
  env.POSTGRES_USER ??= "vibecalculators";
  env.POSTGRES_DB ??= "vibe_calculators_db";
  env.POSTGRES_PASSWORD ??= randomBytes(24).toString("base64").replace(/[/+=]/g, "");
  env.DATABASE_URL ??= `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@postgres:5432/${env.POSTGRES_DB}`;
  env.REDIS_PASSWORD ??= randomBytes(24).toString("base64").replace(/[/+=]/g, "");
  env.REDIS_URL ??= `redis://:${env.REDIS_PASSWORD}@redis:6379/2`;
  env.VIBE_REDIS_DB ??= "2";
  env.VIBE_DEPLOY_MODE = deployMode;
  if (domain) env.VIBE_DOMAIN = domain;
  if (tlsEmail) env.VIBE_TLS_EMAIL = tlsEmail;
  env.VIBE_HTTP_PORT ??= "80";
  env.VIBE_HTTPS_PORT ??= "443";
  env.VIBE_OFFLINE ??= "false";
  env.VIBE_KMS_KEY ??= randomBytes(32).toString("base64");
  env.VIBE_FIRM_NAME = firmName || env.VIBE_FIRM_NAME || "";
  env.VIBE_FIRST_ADMIN_EMAIL = adminEmail || env.VIBE_FIRST_ADMIN_EMAIL || "";
  env.VIBE_VERSION ??= VERSION;
  env.VIBE_IMAGE_TAG ??= "latest";
  return serializeEnv(env);
}
