import Decimal from "decimal.js";
import { rate, type Money, type Rate } from "./types.js";

/**
 * Phase 6 — TVM solver.
 *
 * Canonical equation (build plan §6.1):
 *
 *   PV·(1+i)^n  +  PMT·(1 + i·type)·((1+i)^n − 1)/i  +  FV  =  0
 *
 * Sign convention: cash inflows are positive, outflows are
 * negative. So a borrower who receives 200000 has PV = +200000 and
 * makes payments of PMT < 0.
 *
 * `type` is 0 for end-of-period payments (ordinary annuity) and 1
 * for begin-of-period (annuity due).
 *
 * All inputs and outputs use decimal.js for precision. The numeric
 * input shape exposes Decimal-friendly types so callers don't have
 * to thread Money/Rate through every step — the TVM equation
 * doesn't distinguish dollars from rates internally; it's the
 * caller's job to use the right typed wrapper at the boundary.
 *
 * Per session decision "no TValue regression" the cents-level
 * parity acceptance has been dropped. Correctness is enforced via
 * closed-form algebraic identities (PV computed forward should
 * round-trip back through solveForI etc).
 */

export type AnnuityType = 0 | 1;

export interface TvmInputs {
  /** Present value (cash flow at t=0). Sign per convention. */
  pv: Decimal;
  /** Future value (cash flow at t=n). */
  fv: Decimal;
  /** Periodic payment. */
  pmt: Decimal;
  /** Periodic interest rate as a fraction (0.005 = 0.5%/period). */
  i: Decimal;
  /** Number of periods. */
  n: Decimal;
  /** 0 = ordinary annuity (end-of-period), 1 = annuity due (begin). */
  type: AnnuityType;
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * Evaluate the TVM equation: returns 0 when inputs are consistent.
 * Useful for verifying solver outputs and for the iterative `i`
 * solver's residual.
 */
export function tvmResidual(inputs: TvmInputs): Decimal {
  const { pv, fv, pmt, i, n, type } = inputs;
  if (i.eq(0)) {
    return pv.plus(pmt.times(n)).plus(fv);
  }
  const compound = ONE.plus(i).pow(n);
  const annuityFactor = compound.minus(1).div(i);
  const due = ONE.plus(i.times(type));
  return pv.times(compound).plus(pmt.times(due).times(annuityFactor)).plus(fv);
}

// ---------------------------------------------------------------------
// Closed-form solvers — Phase 6.2
// ---------------------------------------------------------------------

/** Solve for present value given (FV, PMT, i, n, type). */
export function solveForPV(input: Omit<TvmInputs, "pv">): Decimal {
  const { fv, pmt, i, n, type } = input;
  if (i.eq(0)) {
    return ZERO.minus(pmt.times(n)).minus(fv);
  }
  const compound = ONE.plus(i).pow(n);
  const annuityFactor = compound.minus(1).div(i);
  const due = ONE.plus(i.times(type));
  return ZERO.minus(pmt.times(due).times(annuityFactor)).minus(fv).div(compound);
}

/** Solve for future value given (PV, PMT, i, n, type). */
export function solveForFV(input: Omit<TvmInputs, "fv">): Decimal {
  const { pv, pmt, i, n, type } = input;
  if (i.eq(0)) {
    return ZERO.minus(pv).minus(pmt.times(n));
  }
  const compound = ONE.plus(i).pow(n);
  const annuityFactor = compound.minus(1).div(i);
  const due = ONE.plus(i.times(type));
  return ZERO.minus(pv.times(compound)).minus(pmt.times(due).times(annuityFactor));
}

/** Solve for periodic payment given (PV, FV, i, n, type). */
export function solveForPMT(input: Omit<TvmInputs, "pmt">): Decimal {
  const { pv, fv, i, n, type } = input;
  if (i.eq(0)) {
    if (n.eq(0)) {
      throw new Error("Cannot solve for PMT with i=0 and n=0");
    }
    return ZERO.minus(pv).minus(fv).div(n);
  }
  const compound = ONE.plus(i).pow(n);
  const annuityFactor = compound.minus(1).div(i);
  const due = ONE.plus(i.times(type));
  return ZERO.minus(pv.times(compound)).minus(fv).div(due.times(annuityFactor));
}

/** Solve for n (number of periods) given (PV, FV, PMT, i, type). */
export function solveForN(input: Omit<TvmInputs, "n">): Decimal {
  const { pv, fv, pmt, i, type } = input;
  if (i.eq(0)) {
    if (pmt.eq(0)) {
      throw new Error("Cannot solve for n with i=0 and pmt=0");
    }
    return ZERO.minus(pv).minus(fv).div(pmt);
  }
  // n = ln((PMT·(1+i·type) − FV·i) / (PMT·(1+i·type) + PV·i)) / ln(1+i)
  const due = ONE.plus(i.times(type));
  const numerator = pmt.times(due).minus(fv.times(i));
  const denominator = pmt.times(due).plus(pv.times(i));
  if (denominator.eq(0)) {
    throw new Error("solveForN: denominator is zero; check inputs");
  }
  const ratio = numerator.div(denominator);
  if (ratio.lte(0)) {
    throw new Error("solveForN: argument to ln is non-positive; check sign convention");
  }
  return ratio.ln().div(ONE.plus(i).ln());
}

// ---------------------------------------------------------------------
// Iterative solver for i — Phase 6.3
// ---------------------------------------------------------------------

export interface SolverSuccess {
  ok: true;
  value: Rate;
  iterations: number;
  residual: Decimal;
}

export interface SolverFailure {
  ok: false;
  reason: "diverged" | "ill-conditioned" | "sign-error" | "max-iterations" | "domain-error";
  iterations: number;
}

export type SolverResult = SolverSuccess | SolverFailure;

const DEFAULT_TOLERANCE = new Decimal("1e-10");
const DEFAULT_MAX_ITERATIONS = 50;

/**
 * Solve for the periodic interest rate. Newton-Raphson primary,
 * Brent's bisection fallback when Newton diverges.
 */
export function solveForI(
  input: Omit<TvmInputs, "i">,
  options?: { tolerance?: Decimal; maxIterations?: number; initialGuess?: Decimal },
): SolverResult {
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE;
  const maxIter = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  // A reasonable starting guess: pretend zero-rate amortization, then
  // walk in via Newton.
  const guess = options?.initialGuess ?? new Decimal("0.01");

  // Newton-Raphson on f(i) = tvmResidual(...).
  let iVal = guess;
  let lastF: Decimal | null = null;
  for (let k = 0; k < maxIter; k++) {
    const f = tvmResidual({ ...input, i: iVal });
    if (f.abs().lte(tolerance)) {
      return { ok: true, value: rate(iVal), iterations: k, residual: f };
    }
    const fPrime = numericalDerivative(input, iVal);
    if (fPrime.abs().lt("1e-15")) {
      // Switch to Brent's. Bracket between -0.99 (reasonable lower
      // bound) and 1.0 (100%/period upper bound). Most TVM problems
      // live in (-1, 1).
      return brentSolveForI(input, tolerance, maxIter);
    }
    const next = iVal.minus(f.div(fPrime));
    if (!next.isFinite()) {
      return brentSolveForI(input, tolerance, maxIter);
    }
    if (lastF !== null && f.abs().gt(lastF.abs().times(2))) {
      // Diverging; switch to Brent's.
      return brentSolveForI(input, tolerance, maxIter);
    }
    lastF = f;
    iVal = next;
  }
  return { ok: false, reason: "max-iterations", iterations: maxIter };
}

function numericalDerivative(input: Omit<TvmInputs, "i">, i: Decimal): Decimal {
  const h = new Decimal("1e-7");
  const fPlus = tvmResidual({ ...input, i: i.plus(h) });
  const fMinus = tvmResidual({ ...input, i: i.minus(h) });
  return fPlus.minus(fMinus).div(h.times(2));
}

/**
 * Brent's-method bisection fallback over (-0.99, 1.0). If the
 * residual at the endpoints has the same sign, surface a
 * 'sign-error' so the caller can flag bad input.
 */
function brentSolveForI(
  input: Omit<TvmInputs, "i">,
  tolerance: Decimal,
  maxIter: number,
): SolverResult {
  let a = new Decimal("-0.99");
  let b = new Decimal("1.0");
  let fa = tvmResidual({ ...input, i: a });
  let fb = tvmResidual({ ...input, i: b });
  if (fa.times(fb).gt(0)) {
    return { ok: false, reason: "sign-error", iterations: 0 };
  }
  for (let k = 0; k < maxIter; k++) {
    const c = a.plus(b).div(2);
    const fc = tvmResidual({ ...input, i: c });
    if (fc.abs().lte(tolerance) || b.minus(a).abs().lt(tolerance)) {
      return { ok: true, value: rate(c), iterations: k, residual: fc };
    }
    if (fa.times(fc).lt(0)) {
      b = c;
      fb = fc;
    } else {
      a = c;
      fa = fc;
    }
  }
  return { ok: false, reason: "max-iterations", iterations: maxIter };
}

// ---------------------------------------------------------------------
// Convenience wrappers for typed Money/Rate boundaries
// ---------------------------------------------------------------------

export interface TypedTvmInputs {
  pv: Money;
  fv: Money;
  pmt: Money;
  i: Rate;
  n: number; // periods
  type: AnnuityType;
}

export function asInternal(input: TypedTvmInputs): TvmInputs {
  return {
    pv: input.pv,
    fv: input.fv,
    pmt: input.pmt,
    i: input.i,
    n: new Decimal(input.n),
    type: input.type,
  };
}
