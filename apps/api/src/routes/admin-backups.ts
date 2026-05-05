import { Router, type Request, type Response } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { recordAuditEvent } from "../lib/audit-events.js";

/**
 * Phase 25.8 — restore wizard (server-side).
 *
 *   GET  /api/v1/admin/backups                list snapshots in /data/backups
 *   POST /api/v1/admin/backups/:name/restore  record audit event +
 *                                             return the operator-side
 *                                             command to complete the
 *                                             destructive replace.
 *
 * The API container deliberately cannot run `pg_restore` itself —
 * that would require dropping the read-only filesystem and giving
 * the API privileges that violate the rest of the security posture.
 * Instead, the wizard lets the operator pick a backup, enter a
 * "DESTRUCTIVE-REPLACE" confirmation, and then the host runs
 * `vibecalc-installer restore <path> --i-know` to apply it. The
 * recorded audit event ties the UI confirmation to the eventual
 * filesystem-level operation.
 */

const BACKUPS_DIR = process.env.VIBE_BACKUPS_DIR ?? "/data/backups";
const REQUIRED_CONFIRMATION = "DESTRUCTIVE-REPLACE";

export interface AdminBackupsRouteDeps {
  db: Database;
}

const restoreSchema = z.object({
  confirmation: z.string(),
});

export function buildAdminBackupsRouter(deps: AdminBackupsRouteDeps): Router {
  const router = Router();

  router.get("/", requirePermission("backup:create"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    try {
      const backups = await listBackups(BACKUPS_DIR);
      res.json({ backupsDir: BACKUPS_DIR, backups });
    } catch (err) {
      // ENOENT: dir not mounted (e.g. running tests without the
      // volume) — return empty list rather than 500.
      if (isENOENT(err)) {
        res.json({ backupsDir: BACKUPS_DIR, backups: [] });
        return;
      }
      throw err;
    }
  });

  router.post(
    "/:name/restore",
    requirePermission("backup:restore"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const name = readName(req);
      if (!isSafeName(name)) {
        return problem(res, 400, "Bad request", "Invalid backup name");
      }
      const parsed = restoreSchema.safeParse(req.body);
      if (!parsed.success) {
        return problem(res, 400, "Bad request", "Invalid body");
      }
      if (parsed.data.confirmation !== REQUIRED_CONFIRMATION) {
        return problem(
          res,
          400,
          "Confirmation required",
          `Type ${REQUIRED_CONFIRMATION} to confirm — restore overwrites the live database.`,
        );
      }
      const backupPath = path.join(BACKUPS_DIR, name);
      try {
        const stat = await fs.stat(backupPath);
        if (!stat.isDirectory()) {
          return problem(res, 404, "Not found", "Backup not found");
        }
      } catch (err) {
        if (isENOENT(err)) return problem(res, 404, "Not found", "Backup not found");
        throw err;
      }

      await recordAuditEvent(deps.db, {
        action: "backup.restore.requested",
        entityKind: "backup",
        entityId: name,
        actorUserId: req.user.id,
        payload: { backupPath, confirmation: parsed.data.confirmation },
      });

      res.json({
        ok: true,
        message: "Restore intent recorded. Complete the destructive replace from the host with:",
        command: `vibecalc-installer restore ${backupPath} --i-know`,
      });
    },
  );

  return router;
}

interface BackupSummary {
  name: string;
  createdAt: string | null;
  sizeBytes: number;
  manifest: Record<string, unknown> | null;
  files: { pgdump: boolean; pdfOutput: boolean; checksums: boolean };
}

async function listBackups(dir: string): Promise<BackupSummary[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: BackupSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isSafeName(entry.name)) continue;
    const sub = path.join(dir, entry.name);
    const summary: BackupSummary = {
      name: entry.name,
      createdAt: null,
      sizeBytes: 0,
      manifest: null,
      files: { pgdump: false, pdfOutput: false, checksums: false },
    };
    try {
      const files = await fs.readdir(sub);
      for (const f of files) {
        const full = path.join(sub, f);
        const s = await fs.stat(full);
        summary.sizeBytes += s.size;
        if (f === "pgdump.bin") summary.files.pgdump = true;
        else if (f === "pdf-output.tgz") summary.files.pdfOutput = true;
        else if (f === "checksums.sha256") summary.files.checksums = true;
        else if (f === "manifest.json") {
          try {
            summary.manifest = JSON.parse(await fs.readFile(full, "utf-8")) as Record<
              string,
              unknown
            >;
            const created = (summary.manifest as { createdAt?: unknown }).createdAt;
            if (typeof created === "string") summary.createdAt = created;
          } catch {
            // manifest unreadable — leave null
          }
        }
      }
    } catch (err) {
      if (!isENOENT(err)) throw err;
    }
    out.push(summary);
  }
  out.sort((a, b) => (b.createdAt ?? b.name).localeCompare(a.createdAt ?? a.name));
  return out;
}

function readName(req: Request): string {
  return typeof req.params.name === "string" ? req.params.name : "";
}

function isSafeName(name: string): boolean {
  // Backups are named by ISO-ish timestamps. Anything else suggests
  // path traversal or a junk file — refuse.
  return /^[A-Za-z0-9._-]{4,80}$/.test(name);
}

function isENOENT(err: unknown): boolean {
  return Boolean(err) && typeof err === "object" && (err as { code?: string }).code === "ENOENT";
}
