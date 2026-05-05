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
import { scheduleToPdf } from "@vibe-calc/pdf";
import { problem } from "../middleware/auth.js";

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

// Phase 13 workbench/pdf endpoint is purely compute — no DB / KMS
// dependencies. The route is mounted with `buildWorkbenchRouter()`
// directly; we don't intersect a deps type into ServerOptions.

export function buildWorkbenchRouter(): Router {
  const router = Router();

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

    let buf: Buffer;
    try {
      const footer = composeFooter(loanDetails);
      buf = await scheduleToPdf(schedule, {
        calculationLabel: master.label,
        preparedBy: loanDetails.preparedBy ?? req.user.name,
        preparedOn,
        ...(parsed.data.watermark ? { watermark: parsed.data.watermark } : {}),
        ...(footer ? { firmFooter: footer } : {}),
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
