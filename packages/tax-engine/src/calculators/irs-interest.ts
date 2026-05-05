import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 19.5 — IRS interest + failure-to-file / failure-to-pay penalty.
 *
 * IRC §6621: underpayment interest = federal short-term rate + 3%
 * (corporate large underpayments add another 2%). Compounded daily
 * per §6622.
 *
 * Penalties:
 *   - Failure to File (FTF): 5% per month, max 25%, reduced by FTP
 *     in any month both apply. Minimum penalty (for returns > 60
 *     days late): lesser of $510 (2024 / $485 inflation-adjusted)
 *     or 100% of unpaid tax.
 *   - Failure to Pay (FTP): 0.5% per month, max 25%; rises to 1%
 *     after IRS levy/notice. 0.25% if installment agreement in
 *     place.
 *
 * Quarterly rates embedded as constants — production must source
 * from `irs_underpayment_rate` rate-table (deferred to Phase 22).
 */

const inputSchema = z
  .object({
    /** Tax balance owed, on the original return due date. */
    taxBalanceOwed: z.number().nonnegative().finite(),
    /** Original return due date (typically 4/15/yyyy). */
    returnDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Date taxpayer paid (or as-of date for accrual). */
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Was return filed by due date? */
    returnFiledOnTime: z.boolean().default(true),
    /** Date return actually filed (only used if !returnFiledOnTime). */
    actualFilingDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** IRS levy/notice issued (FTP rises to 1%). */
    levyNoticeIssued: z.boolean().default(false),
    /** Installment agreement on file (FTP drops to 0.25%). */
    installmentAgreementOnFile: z.boolean().default(false),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  daysLate: z.number(),
  underpaymentInterest: z.number(),
  failureToPayPenalty: z.number(),
  failureToFilePenalty: z.number(),
  totalDue: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

/**
 * Quarterly underpayment rates per Rev. Rul. (non-corporate). Annual
 * percentage; daily compounding handled in compute(). Stored
 * inclusive: the date is the first day the rate applies.
 *
 * Source: IRS Rev. Ruls. (e.g., 2024-19, 2024-25, 2025-08, 2025-12).
 *
 * Production should source these from a rate table that the IRS
 * publishes ~6 weeks before each quarter — deferred to Phase 22.
 */
const QUARTERLY_RATES: Array<{ start: string; rate: number }> = [
  { start: "2023-10-01", rate: 0.08 },
  { start: "2024-01-01", rate: 0.08 },
  { start: "2024-04-01", rate: 0.08 },
  { start: "2024-07-01", rate: 0.08 },
  { start: "2024-10-01", rate: 0.08 },
  { start: "2025-01-01", rate: 0.08 },
  { start: "2025-04-01", rate: 0.07 },
  { start: "2025-07-01", rate: 0.07 },
  { start: "2025-10-01", rate: 0.07 },
];

const ONE_DAY_MS = 86_400_000;

function dayCount(a: string, b: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / ONE_DAY_MS),
  );
}

/**
 * §6651(a) "month or fraction thereof" — for delay 4/15→4/16, returns 1.
 * For 4/15→5/16, returns 2 (one full month + 1 day = 2 month-fractions).
 * For 4/15→7/14, returns 3 (one full month + one full month + 30-day partial).
 *
 * Walks calendar months: each crossed month boundary increments by 1; if
 * any portion of a final calendar month is crossed, increment again.
 */
function monthsOrFraction(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`);
  const b = new Date(`${toDate}T00:00:00Z`);
  if (b.getTime() <= a.getTime()) return 0;
  // Walk one calendar month at a time from `fromDate` until we pass `toDate`.
  let cursor = new Date(a.getTime());
  let count = 0;
  while (cursor.getTime() < b.getTime()) {
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()),
    );
    count++;
  }
  return count;
}

function rateForDate(dateStr: string): number {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  let current = QUARTERLY_RATES[0]?.rate ?? 0.08;
  for (const r of QUARTERLY_RATES) {
    if (Date.parse(`${r.start}T00:00:00Z`) <= t) current = r.rate;
    else break;
  }
  return current;
}

function dailyAccrue(principal: Decimal, fromDate: string, toDate: string): Decimal {
  // Daily compounding: principal × Π((1 + rate/365)^days_in_segment)
  let result = principal;
  let cursor = fromDate;
  // Walk quarter by quarter for rate transitions.
  while (cursor < toDate) {
    const r = rateForDate(cursor);
    // Find end of current quarter or toDate, whichever is sooner.
    // Date string is regex-validated YYYY-MM-DD; use UTC parser instead of Number().
    const cursorDate = new Date(`${cursor}T00:00:00Z`);
    const yr = cursorDate.getUTCFullYear();
    const mo = cursorDate.getUTCMonth() + 1;
    const nextQuarterMonth = mo <= 3 ? 4 : mo <= 6 ? 7 : mo <= 9 ? 10 : 13;
    const nextQyear = nextQuarterMonth === 13 ? yr + 1 : yr;
    const nextQmo = nextQuarterMonth === 13 ? 1 : nextQuarterMonth;
    const nextQuarterStart = `${nextQyear.toString().padStart(4, "0")}-${nextQmo.toString().padStart(2, "0")}-01`;
    const segmentEnd = nextQuarterStart < toDate ? nextQuarterStart : toDate;
    const days = dayCount(cursor, segmentEnd);
    if (days > 0) {
      // (1 + r/365)^days
      const dailyRate = new Decimal(r).div(365);
      const factor = new Decimal(1).plus(dailyRate).pow(days);
      result = result.times(factor);
    }
    cursor = segmentEnd;
    if (cursor === toDate) break;
  }
  return result;
}

const irsInterest: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.irs_interest_penalty",
    name: "IRS interest & FTF/FTP penalties",
    description:
      "Underpayment interest (§6621, daily compounding §6622) + Failure-to-File (5%/mo, cap 25%) + Failure-to-Pay (0.5%/mo, cap 25%) with stacking adjustment.",
    taxYears: [2024, 2025],
    formReferences: ["IRC §6621", "IRC §6651", "Pub 17"],
    requiredTables: [],
  },
  inputSchema,
  outputSchema,
  validateInputs(raw: unknown): ValidationResult<Input> {
    const parsed = inputSchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  },
  compute(input) {
    const days = dayCount(input.returnDueDate, input.paymentDate);
    const balance = new Decimal(input.taxBalanceOwed);

    // Interest (daily compounded per IRC §6622).
    const accrued = dailyAccrue(balance, input.returnDueDate, input.paymentDate);
    const interest = accrued.minus(balance);

    // FTP: §6651(a)(2) — 0.5%/month or fraction thereof; 0.25% with
    // an installment agreement; 1% after IRS levy/notice. Cap 25%.
    const ftpMonthlyRate = input.installmentAgreementOnFile
      ? 0.0025
      : input.levyNoticeIssued
        ? 0.01
        : 0.005;
    // "Month or fraction" — calendar-month walk from due date.
    const monthsLate = monthsOrFraction(input.returnDueDate, input.paymentDate);
    const ftpPctUncapped = new Decimal(ftpMonthlyRate).times(monthsLate);
    const ftpPctCapped = Decimal.min(ftpPctUncapped, 0.25);
    const ftp = balance.times(ftpPctCapped);

    // FTF: §6651(a)(1) — 5%/month or fraction thereof, cap 25%, reduced
    // by FTP in any month both apply (which is the first 5 months when
    // both run concurrently → net 4.5%/mo for 5 months = 22.5%, then
    // FTP continues alone for another 45 months to reach the 25% FTP cap).
    // Minimum penalty (§6651(a)) for returns >60 days late: lesser of
    // $510 (2024 — adjusted yearly) or 100% of unpaid tax.
    let ftf = new Decimal(0);
    if (!input.returnFiledOnTime && input.actualFilingDate) {
      const ftfMonths = monthsOrFraction(input.returnDueDate, input.actualFilingDate);
      // Net rate = 5% - 0.5% concurrent FTP = 4.5%/mo, capped at 22.5%
      // (5 months × 4.5%). Beyond month 5, FTF is at its 25% cap; FTF's
      // own statutory cap is 25%, but with FTP concurrent through month 5
      // the visible FTF amount is 22.5% net.
      const ftfNetCap = new Decimal(0.045).times(ftfMonths);
      const ftfNet = Decimal.min(ftfNetCap, 0.225);
      ftf = balance.times(ftfNet);
      // Minimum-penalty floor for returns > 60 days late
      // (§6651(a)). Inflation-adjusted: $485 (2023), $510 (2024),
      // $525 (2025) — Rev. Proc. 2024-40 indexes.
      const filingDelayDays = dayCount(input.returnDueDate, input.actualFilingDate);
      if (filingDelayDays > 60) {
        // Date string is regex-validated YYYY-MM-DD upstream; UTC
        // parser is the lint-clean way to pull the year.
        const dueYear = new Date(`${input.returnDueDate}T00:00:00Z`).getUTCFullYear();
        const minPenaltyByYear: Record<number, number> = {
          2023: 485,
          2024: 510,
          2025: 525,
          2026: 540, // estimated; check Rev. Proc. when published
        };
        const minPenaltyAmount = minPenaltyByYear[dueYear] ?? 510;
        const minPenalty = Decimal.min(minPenaltyAmount, balance);
        if (ftf.lt(minPenalty)) ftf = minPenalty;
      }
    }

    const total = balance.plus(interest).plus(ftp).plus(ftf);

    const notes: string[] = [];
    if (input.installmentAgreementOnFile) {
      notes.push("Installment agreement on file: FTP rate reduced to 0.25%/month.");
    }
    if (input.levyNoticeIssued) {
      notes.push("IRS levy/notice issued: FTP rate accelerated to 1%/month.");
    }
    if (!input.returnFiledOnTime) {
      notes.push(
        "FTF stacks with FTP — IRS reduces FTF by the concurrent FTP (net 4.5%/mo for the first 5 months); §6651(a) minimum penalty applies for returns >60 days late.",
      );
    }

    return {
      daysLate: days,
      underpaymentInterest: interest.toDecimalPlaces(2).toNumber(),
      failureToPayPenalty: ftp.toDecimalPlaces(2).toNumber(),
      failureToFilePenalty: ftf.toDecimalPlaces(2).toNumber(),
      totalDue: total.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `IRS interest + penalties on $${input.taxBalanceOwed.toLocaleString("en-US")} due ${input.returnDueDate}, ` +
      `paid ${input.paymentDate} (${output.daysLate} days late): ` +
      `interest $${output.underpaymentInterest.toLocaleString("en-US")}, ` +
      `FTP $${output.failureToPayPenalty.toLocaleString("en-US")}, ` +
      `FTF $${output.failureToFilePenalty.toLocaleString("en-US")}, ` +
      `total due $${output.totalDue.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(irsInterest);

export { irsInterest };
