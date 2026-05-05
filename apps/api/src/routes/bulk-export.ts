import { Router, type Request, type Response } from "express";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import JSZip from "jszip";
import {
  generateSchedule,
  money,
  rate,
  type CashFlowEvent,
  type CompoundingInterval,
  type ComputeMethod,
  type DayCountConvention,
} from "@vibe-calc/calc-engine";
import { calculatorMemoToPdf, scheduleToPdf } from "@vibe-calc/pdf";
import { calculations, type Database } from "@vibe-calc/db";
import { problem, requirePermission } from "../middleware/auth.js";
import { permittedCalculationIds } from "../lib/ownership.js";
import { loadFirmSettings, composeBrandedFooter } from "../lib/firm-settings.js";

/**
 * Phase 13.8 — bulk export.
 *
 *   POST /api/v1/calculations/bulk/zip
 *
 * Body: { ids: string[]; format?: "pdf" }   (other formats reserved for follow-up)
 *
 * Looks up every calc in `ids` that the caller is permitted to read,
 * renders each as a PDF (TVM = scheduleToPdf, anything else =
 * calculatorMemoToPdf using the saved inputs+outputs), bundles into
 * a single ZIP archive, and streams it back. PDFs are tagged with
 * the firm-settings header.
 *
 * Operator-side cap: 50 calcs per call. Anything bigger should run
 * through a queued worker (Phase 13.7 deferred). Mid-batch failures
 * are logged into `errors.txt` inside the ZIP rather than aborting
 * the whole call.
 */

export interface BulkExportRouteDeps {
  db: Database;
}

const MAX_BULK = 50;

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BULK),
  format: z.enum(["pdf"]).default("pdf"),
});

export function buildBulkExportRouter(deps: BulkExportRouteDeps): Router {
  const router = Router();

  router.post("/zip", requirePermission("export:download"), async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const allowed = await permittedCalculationIds(
      { db: deps.db, userId: req.user.id, role: req.user.role },
      parsed.data.ids,
    );
    if (allowed.length === 0) {
      return problem(res, 404, "Not found", "No matching calculations in scope");
    }

    const rows = await deps.db.select().from(calculations).where(inArray(calculations.id, allowed));

    const firm = await loadFirmSettings(deps.db);
    const brandedFooter = composeBrandedFooter(firm, undefined);

    const zip = new JSZip();
    const errors: string[] = [];
    let written = 0;

    for (const calc of rows) {
      try {
        const buf = await renderCalcPdf({
          kind: calc.kind,
          name: calc.name,
          inputs: (calc.inputsJson ?? {}) as Record<string, unknown>,
          outputs: (calc.outputsJson ?? {}) as Record<string, unknown>,
          preparedBy: req.user.name,
          firmName: firm?.firmName ?? undefined,
          firmFooter: brandedFooter,
        });
        const safeName = calc.name.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
        zip.file(`${safeName}-${calc.id.slice(0, 8)}.pdf`, buf);
        written++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${calc.id}\t${calc.name}\t${msg}`);
      }
    }

    if (errors.length > 0) {
      zip.file(
        "errors.txt",
        `Failed to render ${errors.length} of ${rows.length} calculations.\n\n${errors.join("\n")}\n`,
      );
    }

    if (written === 0) {
      return problem(res, 500, "Render failed", "No calculations rendered successfully");
    }

    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="calculations-${today}-${written}.zip"`,
    );
    res.send(buf);
  });

  // Lookup endpoint for bulk-export status (UI uses this to enumerate
  // candidate calcs by id). Kept here so the router self-contains.
  router.post(
    "/preflight",
    requirePermission("export:download"),
    async (req: Request, res: Response) => {
      if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
      const parsed = bodySchema.pick({ ids: true }).safeParse(req.body);
      if (!parsed.success) return problem(res, 400, "Bad request", "Invalid body");
      const allowed = await permittedCalculationIds(
        { db: deps.db, userId: req.user.id, role: req.user.role },
        parsed.data.ids,
      );
      const rows = await deps.db
        .select({
          id: calculations.id,
          name: calculations.name,
          kind: calculations.kind,
          updatedAt: calculations.updatedAt,
        })
        .from(calculations)
        .where(inArray(calculations.id, allowed));
      res.json({ matched: rows.length, requested: parsed.data.ids.length, rows });
    },
  );

  return router;
}

/**
 * Render one calculation as a PDF buffer. TVM calcs go through the
 * full schedule renderer; everything else produces a generic
 * calculator-memo PDF using the saved inputs / outputs.
 */
async function renderCalcPdf(args: {
  kind: string;
  name: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  preparedBy: string;
  firmName?: string | undefined;
  firmFooter?: string | undefined;
}): Promise<Buffer> {
  if (args.kind === "tvm") {
    return renderTvmPdf(args);
  }
  return calculatorMemoToPdf({
    kind: args.kind,
    name: args.name,
    inputs: args.inputs,
    outputs: args.outputs,
    narrative: typeof args.outputs.narrative === "string" ? args.outputs.narrative : "",
    formReferences: [],
    preparedBy: args.preparedBy,
    preparedOn: new Date(),
    ...(args.firmName ? { firmName: args.firmName } : {}),
    ...(args.firmFooter ? { firmFooter: args.firmFooter } : {}),
  });
}

async function renderTvmPdf(args: {
  name: string;
  inputs: Record<string, unknown>;
  preparedBy: string;
  firmName?: string | undefined;
  firmFooter?: string | undefined;
}): Promise<Buffer> {
  const inputs = args.inputs as {
    master?: {
      rate?: string;
      compounding?: CompoundingInterval;
      dayCount?: DayCountConvention;
      paymentTiming?: 0 | 1;
      computeMethod?: ComputeMethod;
    };
    rows?: Array<{
      date?: string;
      kind?: CashFlowEvent["kind"];
      amount?: string;
      rateValue?: string;
      count?: string;
      interval?: CompoundingInterval | "";
      memo?: string;
    }>;
    loanDetails?: { preparedBy?: string };
  };
  const master = inputs.master ?? {};
  const events: CashFlowEvent[] = (inputs.rows ?? [])
    .filter((r) => r.date && r.kind)
    .map((r) => {
      const event: CashFlowEvent = {
        date: new Date(`${r.date}T00:00:00.000Z`),
        kind: r.kind as CashFlowEvent["kind"],
      };
      if (r.amount) event.amount = money(r.amount);
      if (r.rateValue) event.rate = rate(r.rateValue);
      if (r.count) event.count = Number(r.count);
      if (r.interval) event.interval = r.interval as CompoundingInterval;
      if (r.memo) event.memo = r.memo;
      return event;
    });
  if (events.length === 0) {
    throw new Error("TVM calc has no rows to render");
  }
  const schedule = generateSchedule(events, {
    rate: rate(master.rate ?? "0"),
    compounding: master.compounding ?? "monthly",
    dayCount: master.dayCount ?? "30/360",
    paymentTiming: master.paymentTiming ?? 0,
    computeMethod: master.computeMethod ?? "Normal",
  });
  return scheduleToPdf(schedule, {
    calculationLabel: args.name,
    preparedBy: inputs.loanDetails?.preparedBy ?? args.preparedBy,
    preparedOn: new Date(),
    ...(args.firmName ? { firmName: args.firmName } : {}),
    ...(args.firmFooter ? { firmFooter: args.firmFooter } : {}),
  });
}
