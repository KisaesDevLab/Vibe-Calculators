import { Router, type Request, type Response } from "express";
import multer from "multer";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { extractionJobs, type Database } from "@vibe-calc/db";
import { extractLoanAgreement, flagLowConfidenceFields, type LlmProvider } from "@vibe-calc/llm";
import { problem, requirePermission } from "../middleware/auth.js";
import { recordAuditEvent } from "../lib/audit-events.js";
import { userOwnsExtraction } from "../lib/ownership.js";
import { parseDocument, DocumentParseError, redactSensitive } from "../lib/document-parsing.js";

/**
 * Phase 23 — extraction routes.
 *
 *   POST   /api/v1/extractions          create job (preparer+, ai:use)
 *   GET    /api/v1/extractions          list (filterable by status / engagement)
 *   GET    /api/v1/extractions/:id      detail
 *   POST   /api/v1/extractions/:id/run  invoke LLM, persist result, set status
 *   POST   /api/v1/extractions/:id/approve
 *
 * The split between create + run keeps the upload synchronous and
 * the LLM call (slow / costly) explicit. In production a worker
 * could pick up `pending` jobs automatically.
 */

export interface ExtractionRouteDeps {
  db: Database;
  llmProvider?: LlmProvider | undefined;
  /** Threshold below which a field is flagged for review. Default 0.7. */
  confidenceThreshold?: number;
  /** Hard timeout for the LLM call. Default 60s. */
  llmTimeoutMs?: number;
}

const createSchema = z.object({
  sourceFilename: z.string().min(1).max(255),
  documentText: z.string().min(20).max(500_000),
  clientId: z.string().min(1).optional(),
  engagementId: z.string().min(1).optional(),
});

const listQuery = z.object({
  status: z.enum(["pending", "processing", "needs_review", "approved", "failed"]).optional(),
  engagementId: z.string().optional(),
});

export function buildExtractionsRouter(deps: ExtractionRouteDeps): Router {
  const router = Router();

  // Phase 23.6/7 — document upload. Multer holds the file in memory
  // (≤ 10 MB; loan agreements are typically 1–3 MB). The file never
  // touches disk; we parse to text and discard the buffer.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  router.post(
    "/upload",
    requirePermission("ai:use"),
    upload.single("file"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) return problem(res, 400, "Bad request", "Missing 'file' field");
      const redact = String((req.body as { redact?: unknown }).redact ?? "false") === "true";
      try {
        const result = await parseDocument(file.buffer, file.mimetype, file.originalname);
        const final = redact ? redactSensitive(result.text) : null;
        res.json({
          filename: file.originalname,
          mimeType: file.mimetype,
          characters: result.characters,
          ...(result.pages !== undefined ? { pages: result.pages } : {}),
          text: final ? final.redacted : result.text,
          ...(final ? { redactionsApplied: final.replacements } : {}),
        });
      } catch (err) {
        if (err instanceof DocumentParseError) {
          return problem(res, 415, "Unsupported media", err.message);
        }
        return problem(res, 500, "Parse failed", err instanceof Error ? err.message : String(err));
      }
    },
  );

  router.post("/", requirePermission("ai:use"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return problem(res, 400, "Bad request", "Invalid body", { issues: parsed.error.issues });
    const [row] = await deps.db
      .insert(extractionJobs)
      .values({
        sourceFilename: parsed.data.sourceFilename,
        documentText: parsed.data.documentText,
        clientId: parsed.data.clientId ?? null,
        engagementId: parsed.data.engagementId ?? null,
        createdBy: req.user.id,
      })
      .returning();
    if (!row) return problem(res, 500, "Internal error", "Insert returned no row");
    res.status(201).json({ extraction: serialize(row) });
  });

  router.get("/", requirePermission("ai:use"), async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return problem(res, 400, "Bad request", "Invalid query");
    const conds = [];
    if (parsed.data.status) conds.push(eq(extractionJobs.status, parsed.data.status));
    if (parsed.data.engagementId)
      conds.push(eq(extractionJobs.engagementId, parsed.data.engagementId));
    const rows = await deps.db
      .select()
      .from(extractionJobs)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(extractionJobs.createdAt))
      .limit(100);
    res.json({ extractions: rows.map(serialize) });
  });

  router.get("/:id", requirePermission("ai:use"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    if (
      !(await userOwnsExtraction({ db: deps.db, userId: req.user.id, role: req.user.role }, id))
    ) {
      return problem(res, 404, "Not found", "Extraction not found");
    }
    const [row] = await deps.db
      .select()
      .from(extractionJobs)
      .where(eq(extractionJobs.id, id))
      .limit(1);
    if (!row) return problem(res, 404, "Not found", "Extraction not found");
    res.json({
      extraction: serialize(row),
      flaggedFields: flagLowFromRow(row, deps.confidenceThreshold ?? 0.7),
    });
  });

  router.post("/:id/run", requirePermission("ai:use"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    if (
      !(await userOwnsExtraction({ db: deps.db, userId: req.user.id, role: req.user.role }, id))
    ) {
      return problem(res, 404, "Not found", "Extraction not found");
    }
    if (!deps.llmProvider) {
      return problem(res, 503, "Service unavailable", "No LLM provider configured");
    }

    const [job] = await deps.db
      .select()
      .from(extractionJobs)
      .where(eq(extractionJobs.id, id))
      .limit(1);
    if (!job) return problem(res, 404, "Not found", "Extraction not found");
    if (job.status === "approved") {
      return problem(res, 409, "Conflict", "Extraction already approved");
    }
    await deps.db
      .update(extractionJobs)
      .set({ status: "processing" })
      .where(eq(extractionJobs.id, id));

    // Defense against a hung LLM call leaving the row in 'processing'
    // forever. A 60-second budget is generous for prompt extractions;
    // if the provider truly needs longer, increase the env knob.
    const llmTimeoutMs = deps.llmTimeoutMs ?? 60_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const out = await Promise.race([
        extractLoanAgreement(deps.llmProvider, job.documentText),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`LLM provider timed out after ${llmTimeoutMs}ms`)),
            llmTimeoutMs,
          );
        }),
      ]);
      // Clear timer on success so we don't leak a setTimeout per
      // request (the GC would eventually reclaim it but cumulative
      // pending timers slow the event loop under load).
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const flagged = flagLowConfidenceFields(out.extraction, deps.confidenceThreshold ?? 0.7);
      // Phase 23.7 — every extraction lands at needs_review so a human
      // explicitly approves before downstream use, regardless of the
      // confidence-flag count. The flag count drives UI emphasis.
      const newStatus = "needs_review";
      const [updated] = await deps.db
        .update(extractionJobs)
        .set({
          status: newStatus,
          extractedJson: out.extraction as unknown as Record<string, unknown>,
          fieldConfidence: out.extraction.fieldConfidence,
          providerResponseId: out.responseId,
          inputTokens: out.tokens.input,
          outputTokens: out.tokens.output,
          completedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(extractionJobs.id, id))
        .returning();
      await recordAuditEvent(deps.db, {
        action: "calculation.create",
        entityKind: "calculation",
        entityId: id,
        actorUserId: req.user.id,
        payload: {
          extractionId: id,
          flaggedFields: flagged,
          inputTokens: out.tokens.input,
          outputTokens: out.tokens.output,
          provider: deps.llmProvider.name,
        },
      });
      res.json({ extraction: serialize(updated ?? job), flaggedFields: flagged });
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const message = err instanceof Error ? err.message : String(err);
      await deps.db
        .update(extractionJobs)
        .set({
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
        })
        .where(eq(extractionJobs.id, id));
      return problem(res, 502, "LLM error", message);
    }
  });

  router.post("/:id/approve", requirePermission("ai:use"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const id = readId(req);
    if (!id) return problem(res, 400, "Bad request", "Missing id");
    if (
      !(await userOwnsExtraction({ db: deps.db, userId: req.user.id, role: req.user.role }, id))
    ) {
      return problem(res, 404, "Not found", "Extraction not found");
    }
    // Separation-of-duty: a user cannot approve an extraction they
    // themselves created. Admin override allowed (admin runs and
    // approves their own work routinely during firm setup).
    const [job] = await deps.db
      .select({ createdBy: extractionJobs.createdBy })
      .from(extractionJobs)
      .where(eq(extractionJobs.id, id))
      .limit(1);
    if (job && job.createdBy === req.user.id && req.user.role !== "admin") {
      return problem(
        res,
        409,
        "Conflict",
        "You cannot approve an extraction you created. A different reviewer must approve.",
      );
    }
    const [updated] = await deps.db
      .update(extractionJobs)
      .set({
        status: "approved",
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
      })
      .where(eq(extractionJobs.id, id))
      .returning();
    if (!updated) return problem(res, 404, "Not found", "Extraction not found");
    await recordAuditEvent(deps.db, {
      action: "calculation.approve",
      entityKind: "calculation",
      entityId: id,
      actorUserId: req.user.id,
      payload: { extractionId: id },
    });
    res.json({ extraction: serialize(updated) });
  });

  return router;
}

function readId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

function serialize(row: typeof extractionJobs.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    clientId: row.clientId,
    engagementId: row.engagementId,
    sourceFilename: row.sourceFilename,
    status: row.status,
    extractedJson: row.extractedJson,
    fieldConfidence: row.fieldConfidence,
    providerResponseId: row.providerResponseId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    errorMessage: row.errorMessage,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function flagLowFromRow(row: typeof extractionJobs.$inferSelect, threshold: number): string[] {
  const conf = (row.fieldConfidence ?? {}) as Record<string, number>;
  return Object.entries(conf)
    .filter(([, v]) => typeof v === "number" && v < threshold)
    .map(([k]) => k);
}
