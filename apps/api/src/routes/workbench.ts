import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  generateSchedule,
  money,
  rate,
  type CashFlowEvent,
  type CompoundingInterval,
  type ComputeMethod,
  type DayCountConvention,
} from "@vibe-calc/calc-engine";
import type { Database } from "@vibe-calc/db";
import type { EmailProvider } from "@vibe-calc/email";
import { scheduleToPdf, scheduleToCsv, scheduleToXlsx, scheduleToDocx } from "@vibe-calc/pdf";
import { problem } from "../middleware/auth.js";
import { loadFirmSettings, composeBrandedFooter } from "../lib/firm-settings.js";

/**
 * Phase 13 — workbench PDF endpoint.
 *
 *   POST /api/v1/workbench/pdf  → application/pdf attachment
 *
 * Takes the same shape the React workbench owns (master settings +
 * editable rows + loan-details metadata), runs the engine on the
 * server, and renders the schedule via @vibe-calc/pdf's
 * AmortizationDocument template. The web app POSTs the raw
 * workbench state and gets back a Buffer — no need to keep two
 * schedule renderers in sync between client and server.
 */

const compoundingEnum = z.enum([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semi-annual",
  "annual",
]);
const dayCountEnum = z.enum([
  "30/360",
  "30/360-US",
  "30/365",
  "ACT/365",
  "ACT/360",
  "ACT/ACT-ISDA",
]);
const computeEnum = z.enum(["Normal", "USRule", "RuleOf78", "Canadian", "ExactDays"]);
const eventKindEnum = z.enum([
  "loan",
  "payment",
  "deposit",
  "withdrawal",
  "balloon",
  "prepayment",
  "rate_change",
  "interest_only",
  "stepped_amount",
  "memo",
]);

const bodySchema = z.object({
  master: z.object({
    label: z.string(),
    rate: z.string(),
    compounding: compoundingEnum,
    dayCount: dayCountEnum,
    paymentTiming: z.union([z.literal(0), z.literal(1)]),
    computeMethod: computeEnum,
  }),
  rows: z
    .array(
      z.object({
        date: z.string().min(1),
        kind: eventKindEnum,
        amount: z.string().optional().default(""),
        rateValue: z.string().optional().default(""),
        count: z.string().optional().default(""),
        interval: z
          .union([compoundingEnum, z.literal("")])
          .optional()
          .default(""),
        memo: z.string().optional().default(""),
      }),
    )
    .min(1),
  loanDetails: z
    .object({
      borrowerName: z.string().optional(),
      lenderName: z.string().optional(),
      loanType: z.string().optional(),
      preparedBy: z.string().optional(),
      preparedOn: z.string().optional(),
      originalLoanDate: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional()
    .default({}),
  /** Optional draft watermark. */
  watermark: z.string().optional(),
});

/**
 * Phase 13.3 — the export endpoints now read firm-settings to brand
 * the PDF / DOCX headers and footers. Pass the same Drizzle handle
 * the rest of the auth-aware routes use.
 *
 * Phase 13.9 — `emailProvider` powers the email-this-PDF endpoint.
 * Optional; the route returns 503 with a clear message when not
 * configured.
 */
export interface WorkbenchRouteDeps {
  db?: Database;
  emailProvider?: EmailProvider | undefined;
}

/** Parse + validate the workbench body and run the engine. Returns
 *  either the computed schedule (and the original parsed body) or an
 *  error tuple to forward to `problem(...)`. Shared between the
 *  /pdf, /xlsx, and /csv endpoints. */
type ScheduleBuildResult =
  | { ok: true; data: z.infer<typeof bodySchema>; schedule: ReturnType<typeof generateSchedule> }
  | {
      ok: false;
      status: number;
      title: string;
      detail: string;
      issues?: { path: string; message: string }[];
    };

async function buildScheduleFromBody(body: unknown): Promise<ScheduleBuildResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      title: "Bad request",
      detail: "Invalid workbench body",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const { master, rows } = parsed.data;
  let events: CashFlowEvent[];
  try {
    events = rows
      .filter((r) => r.date && r.kind)
      .map((r) => {
        const event: CashFlowEvent = {
          date: new Date(`${r.date}T00:00:00.000Z`),
          kind: r.kind,
        };
        if (r.amount) event.amount = money(r.amount);
        if (r.rateValue) event.rate = rate(r.rateValue);
        if (r.count) event.count = Number(r.count);
        if (r.interval) event.interval = r.interval as CompoundingInterval;
        if (r.memo) event.memo = r.memo;
        return event;
      });
  } catch (err) {
    return {
      ok: false,
      status: 400,
      title: "Bad request",
      detail: `Could not parse rows: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (events.length === 0) {
    return {
      ok: false,
      status: 400,
      title: "Bad request",
      detail: "No valid rows in workbench body",
    };
  }
  try {
    const schedule = generateSchedule(events, {
      rate: rate(master.rate),
      compounding: master.compounding,
      dayCount: master.dayCount as DayCountConvention,
      paymentTiming: master.paymentTiming,
      computeMethod: master.computeMethod as ComputeMethod,
    });
    return { ok: true, data: parsed.data, schedule };
  } catch (err) {
    return {
      ok: false,
      status: 422,
      title: "Compute failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function buildWorkbenchRouter(deps: WorkbenchRouteDeps = {}): Router {
  const router = Router();
  const db = deps.db;
  const emailProvider = deps.emailProvider;

  router.post("/pdf", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid workbench body", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const { master, rows, loanDetails } = parsed.data;

    // Build engine events the same way useWorkbenchStore.rowsToEvents does.
    let events: CashFlowEvent[];
    try {
      events = rows
        .filter((r) => r.date && r.kind)
        .map((r) => {
          const event: CashFlowEvent = {
            date: new Date(`${r.date}T00:00:00.000Z`),
            kind: r.kind,
          };
          if (r.amount) event.amount = money(r.amount);
          if (r.rateValue) event.rate = rate(r.rateValue);
          if (r.count) event.count = Number(r.count);
          if (r.interval) event.interval = r.interval as CompoundingInterval;
          if (r.memo) event.memo = r.memo;
          return event;
        });
    } catch (err) {
      return problem(
        res,
        400,
        "Bad request",
        `Could not parse rows: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (events.length === 0) {
      return problem(res, 400, "Bad request", "No valid rows in workbench body");
    }

    let schedule;
    try {
      schedule = generateSchedule(events, {
        rate: rate(master.rate),
        compounding: master.compounding,
        dayCount: master.dayCount as DayCountConvention,
        paymentTiming: master.paymentTiming,
        computeMethod: master.computeMethod as ComputeMethod,
      });
    } catch (err) {
      return problem(res, 422, "Compute failed", err instanceof Error ? err.message : String(err));
    }

    // Stitch the loan-details metadata + the operator's display name
    // into the AmortizationPdfOptions header. preparedOn defaults to
    // today when the operator left the workbench field blank.
    const preparedOn = loanDetails.preparedOn ? new Date(loanDetails.preparedOn) : new Date();

    const firm = db ? await loadFirmSettings(db) : null;

    let buf: Buffer;
    try {
      const operatorFooter = composeFooter(loanDetails);
      const brandedFooter = composeBrandedFooter(firm, operatorFooter);
      buf = await scheduleToPdf(schedule, {
        calculationLabel: master.label,
        preparedBy: loanDetails.preparedBy ?? req.user.name,
        preparedOn,
        ...(parsed.data.watermark ? { watermark: parsed.data.watermark } : {}),
        ...(brandedFooter ? { firmFooter: brandedFooter } : {}),
        ...(firm?.firmName ? { firmName: firm.firmName } : {}),
      });
    } catch (err) {
      return problem(
        res,
        500,
        "PDF render failed",
        err instanceof Error ? err.message : String(err),
      );
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugify(master.label || "schedule")}-${preparedOn
        .toISOString()
        .slice(0, 10)}.pdf"`,
    );
    res.send(buf);
  });

  // Phase 13.9 — email this PDF.
  router.post("/email-pdf", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    if (!emailProvider) {
      return problem(
        res,
        503,
        "Email provider not configured",
        "No SMTP / Postmark / EmailIt provider available. Set provider env in .env and restart.",
      );
    }
    const recipientSchema = z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(200).optional(),
      message: z.string().max(2000).optional(),
    });
    const recipientResult = recipientSchema.safeParse(req.body?.recipient);
    if (!recipientResult.success) {
      return problem(res, 400, "Bad request", "Invalid recipient", {
        issues: recipientResult.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const result = await buildScheduleFromBody(req.body);
    if (!result.ok) {
      return problem(
        res,
        result.status,
        result.title,
        result.detail,
        result.issues ? { issues: result.issues } : undefined,
      );
    }
    const firm = db ? await loadFirmSettings(db) : null;
    const preparedOn = result.data.loanDetails.preparedOn
      ? new Date(result.data.loanDetails.preparedOn)
      : new Date();
    let buf: Buffer;
    try {
      const operatorFooter = composeFooter(result.data.loanDetails);
      const brandedFooter = composeBrandedFooter(firm, operatorFooter);
      buf = await scheduleToPdf(result.schedule, {
        calculationLabel: result.data.master.label,
        preparedBy: result.data.loanDetails.preparedBy ?? req.user.name,
        preparedOn,
        ...(brandedFooter ? { firmFooter: brandedFooter } : {}),
        ...(firm?.firmName ? { firmName: firm.firmName } : {}),
      });
    } catch (err) {
      return problem(
        res,
        500,
        "PDF render failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    const filename = `${slugify(result.data.master.label || "schedule")}-${preparedOn
      .toISOString()
      .slice(0, 10)}.pdf`;
    try {
      await emailProvider.send({
        to: recipientResult.data.to,
        subject:
          recipientResult.data.subject ??
          `${firm?.firmName ?? "Vibe Calculators"} — ${result.data.master.label || "Schedule"}`,
        text:
          (recipientResult.data.message ?? "") +
          (recipientResult.data.message ? "\n\n" : "") +
          `Schedule attached: ${filename}\n` +
          `Prepared by: ${result.data.loanDetails.preparedBy ?? req.user.name}\n` +
          `On: ${preparedOn.toISOString().slice(0, 10)}`,
        attachments: [
          {
            filename,
            contentType: "application/pdf",
            content: buf.toString("base64"),
          },
        ],
      });
    } catch (err) {
      return problem(
        res,
        502,
        "Email delivery failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    res.json({ ok: true, to: recipientResult.data.to, filename });
  });

  router.post("/csv", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const result = await buildScheduleFromBody(req.body);
    if (!result.ok) {
      return problem(
        res,
        result.status,
        result.title,
        result.detail,
        result.issues ? { issues: result.issues } : undefined,
      );
    }
    const csv = scheduleToCsv(result.schedule);
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugify(result.data.master.label || "schedule")}-${today}.csv"`,
    );
    res.send(csv);
  });

  router.post("/docx", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const result = await buildScheduleFromBody(req.body);
    if (!result.ok) {
      return problem(
        res,
        result.status,
        result.title,
        result.detail,
        result.issues ? { issues: result.issues } : undefined,
      );
    }
    const firmDocx = db ? await loadFirmSettings(db) : null;
    let buf: Buffer;
    try {
      const preparedOn = result.data.loanDetails.preparedOn
        ? new Date(result.data.loanDetails.preparedOn)
        : new Date();
      buf = await scheduleToDocx(result.schedule, {
        calculationLabel: result.data.master.label,
        preparedBy: result.data.loanDetails.preparedBy ?? req.user.name,
        preparedOn,
        ...(firmDocx?.firmName ? { firmName: firmDocx.firmName } : {}),
        ...(result.data.loanDetails.notes ? { narrative: result.data.loanDetails.notes } : {}),
      });
    } catch (err) {
      return problem(
        res,
        500,
        "DOCX render failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugify(result.data.master.label || "schedule")}-${today}.docx"`,
    );
    res.send(buf);
  });

  router.post("/xlsx", async (req: Request, res: Response) => {
    if (!req.user) return problem(res, 401, "Unauthorized", "Authentication required");
    const result = await buildScheduleFromBody(req.body);
    if (!result.ok) {
      return problem(
        res,
        result.status,
        result.title,
        result.detail,
        result.issues ? { issues: result.issues } : undefined,
      );
    }
    const firmXlsx = db ? await loadFirmSettings(db) : null;
    let buf: Buffer;
    try {
      buf = await scheduleToXlsx(result.schedule, {
        calculationLabel: result.data.master.label,
        ...(firmXlsx?.firmName ? { firmName: firmXlsx.firmName } : {}),
      });
    } catch (err) {
      return problem(
        res,
        500,
        "XLSX render failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugify(result.data.master.label || "schedule")}-${today}.xlsx"`,
    );
    res.send(buf);
  });

  return router;
}

function composeFooter(d: {
  borrowerName?: string | undefined;
  lenderName?: string | undefined;
  loanType?: string | undefined;
}): string | undefined {
  const parts: string[] = [];
  if (d.borrowerName) parts.push(`Borrower: ${d.borrowerName}`);
  if (d.lenderName) parts.push(`Lender: ${d.lenderName}`);
  if (d.loanType) parts.push(d.loanType);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
