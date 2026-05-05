import {
  money,
  rate,
  solveForFV,
  solveForI,
  solveForN,
  solveForPMT,
  solveForPV,
  type CompoundingInterval,
} from "@vibe-calc/calc-engine";
import Decimal from "decimal.js";
import type { GridRow, MasterUiState } from "@/store/workbench";

/**
 * Phase 11.17 — Solve-for-Unknown on the workbench grid.
 *
 * Detects the canonical TVM shape (one Loan + one level Payment series,
 * optional Balloon at the end) and dispatches to the closed-form
 * calc-engine solver based on which cell is U-marked. Anything more
 * complex (multiple unknowns, irregular events, mid-stream rate
 * changes) returns a structured error so the workbench can surface a
 * clear "use the standalone TVM solver calculator" hint.
 */

export type SolveResult =
  | { ok: true; rowId: string; field: "amount" | "rateValue" | "count"; value: string }
  | { ok: false; reason: string };

const PERIODS_PER_YEAR: Record<CompoundingInterval, number> = {
  daily: 365,
  weekly: 52,
  biweekly: 26,
  "half-month": 24,
  "four-week": 13,
  monthly: 12,
  "bi-monthly": 6,
  quarterly: 4,
  "semi-annual": 2,
  annual: 1,
  continuous: 12,
  "exact-days": 12,
};

/** Find the single U-marked cell across the grid. Returns null when 0
 *  or > 1 are flagged. */
function findUnknown(
  rows: GridRow[],
): { rowId: string; field: "amount" | "rateValue" | "count" } | null {
  const found: Array<{ rowId: string; field: "amount" | "rateValue" | "count" }> = [];
  for (const r of rows) {
    if (r.amountUnknown) found.push({ rowId: r.rowId, field: "amount" });
    if (r.rateValueUnknown) found.push({ rowId: r.rowId, field: "rateValue" });
    if (r.countUnknown) found.push({ rowId: r.rowId, field: "count" });
  }
  return found.length === 1 ? found[0]! : null;
}

interface CanonicalShape {
  loan: GridRow;
  payment: GridRow;
  balloon: GridRow | null;
  paymentsPerYear: number;
}

/** Recognize the canonical mortgage / amortization shape. */
function detectShape(rows: GridRow[], master: MasterUiState): CanonicalShape | null {
  // Drop empty / memo-only rows.
  const live = rows.filter((r) => r.kind !== "memo" && (r.amount || r.amountUnknown || r.date));
  const loans = live.filter((r) => r.kind === "loan");
  const payments = live.filter((r) => r.kind === "payment");
  const balloons = live.filter((r) => r.kind === "balloon");
  const others = live.filter((r) => !["loan", "payment", "balloon"].includes(r.kind));

  if (loans.length !== 1) return null;
  if (payments.length !== 1) return null;
  if (balloons.length > 1) return null;
  if (others.length > 0) return null;

  const payment = payments[0]!;
  const interval = (payment.interval || master.compounding) as CompoundingInterval;
  const paymentsPerYear = PERIODS_PER_YEAR[interval];
  return {
    loan: loans[0]!,
    payment,
    balloon: balloons[0] ?? null,
    paymentsPerYear,
  };
}

function decOrZero(s: string): Decimal {
  if (!s) return new Decimal(0);
  try {
    return new Decimal(s);
  } catch {
    return new Decimal(0);
  }
}

export function solveWorkbench(rows: GridRow[], master: MasterUiState): SolveResult {
  const target = findUnknown(rows);
  if (!target) {
    return {
      ok: false,
      reason:
        "Mark exactly one cell as Unknown (click the U badge) before solving. Multiple unknowns aren't supported by the closed-form solvers.",
    };
  }
  const shape = detectShape(rows, master);
  if (!shape) {
    return {
      ok: false,
      reason:
        "Solve-on-grid recognises a single Loan + a single Payment series + an optional Balloon. For more complex shapes, use the standalone TVM solver in /calculators.",
    };
  }
  const { loan, payment, balloon, paymentsPerYear } = shape;
  const annualRate = decOrZero(master.rate);
  const periodicRate = annualRate.div(paymentsPerYear);
  const annuityType: 0 | 1 = master.paymentTiming;

  // Sign convention: cash inflows positive, outflows negative. The
  // borrower receives the loan (positive PV) and makes payments
  // (negative PMT). The engine's solver expects the consistent
  // signed-residual = 0 form.
  const pv = loan.amountUnknown ? null : decOrZero(loan.amount);
  const pmt = payment.amountUnknown ? null : decOrZero(payment.amount).neg();
  const n = payment.countUnknown ? null : decOrZero(payment.count);
  const fv = balloon
    ? balloon.amountUnknown
      ? null
      : decOrZero(balloon.amount).neg()
    : new Decimal(0);

  // Identify which engine call to make based on the U cell.
  // We accept rate U on either the master OR on a designated payment
  // row; for MVP only payment-amount and master-rate (mapped via
  // `payment.rateValueUnknown`) are wired.

  if (target.field === "amount" && target.rowId === payment.rowId) {
    if (pv === null || n === null || fv === null) {
      return {
        ok: false,
        reason:
          "Solving for payment requires Loan amount, Count, and Balloon (if present) to be known.",
      };
    }
    const result = solveForPMT({
      pv,
      fv,
      i: periodicRate,
      n,
      type: annuityType,
    });
    // Engine returns a signed payment (negative because outflow); the
    // workbench convention stores positive amounts on the row.
    const value = result.abs().toFixed(2);
    return { ok: true, rowId: payment.rowId, field: "amount", value };
  }

  if (target.field === "amount" && target.rowId === loan.rowId) {
    if (pmt === null || n === null || fv === null) {
      return {
        ok: false,
        reason:
          "Solving for loan amount requires Payment, Count, and Balloon (if present) to be known.",
      };
    }
    const result = solveForPV({
      fv,
      pmt,
      i: periodicRate,
      n,
      type: annuityType,
    });
    return { ok: true, rowId: loan.rowId, field: "amount", value: result.abs().toFixed(2) };
  }

  if (target.field === "amount" && balloon && target.rowId === balloon.rowId) {
    if (pv === null || pmt === null || n === null) {
      return {
        ok: false,
        reason: "Solving for balloon requires Loan, Payment, and Count to be known.",
      };
    }
    const result = solveForFV({ pv, pmt, i: periodicRate, n, type: annuityType });
    return { ok: true, rowId: balloon.rowId, field: "amount", value: result.abs().toFixed(2) };
  }

  if (target.field === "count" && target.rowId === payment.rowId) {
    if (pv === null || pmt === null || fv === null) {
      return {
        ok: false,
        reason: "Solving for count requires Loan, Payment, and Balloon (if present) to be known.",
      };
    }
    const result = solveForN({ pv, fv, pmt, i: periodicRate, type: annuityType });
    return { ok: true, rowId: payment.rowId, field: "count", value: result.toFixed(0) };
  }

  if (target.field === "rateValue" && target.rowId === payment.rowId) {
    if (pv === null || pmt === null || n === null || fv === null) {
      return {
        ok: false,
        reason:
          "Solving for rate requires Loan, Payment, Count, and Balloon (if present) to be known.",
      };
    }
    const result = solveForI({ pv, fv, pmt, n, type: annuityType });
    if (!result.ok) {
      return {
        ok: false,
        reason: `Rate solver did not converge (${result.reason}). Try the standalone TVM solver in /calculators with an explicit initial guess.`,
      };
    }
    // The solved value is the periodic rate; multiply by paymentsPerYear
    // to land back on the master's annual scale. We write it on the
    // payment row's rate column for clarity, but strictly speaking it
    // belongs on the master rate field.
    const annualSolved = result.value.times(paymentsPerYear);
    return { ok: true, rowId: payment.rowId, field: "rateValue", value: annualSolved.toFixed(6) };
  }

  return {
    ok: false,
    reason: `Solving the ${target.field} on a ${
      rows.find((r) => r.rowId === target.rowId)?.kind ?? "?"
    } row isn't supported in this round. Use the standalone TVM solver in /calculators for that case.`,
  };
}

// Lightweight helper: type-guard the calc-engine's money() factory's
// return for situations where the consumer needs both the engine's
// branded type and a Decimal cast at once. Imported for completeness;
// not currently used in solveWorkbench since the solver functions
// already accept plain Decimal.
void money;
void rate;
