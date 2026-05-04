import Decimal from "decimal.js";
import { money, rate, type Money, type Rate } from "./types.js";
import { yearFraction, type DayCountConvention } from "./day-count.js";
import { solveForI } from "./tvm-solver.js";

/**
 * Phase 9 — specialized TVM templates.
 *
 * Each template is a thin façade over the Phase 6 solver + Phase 7
 * cash-flow engine that captures one common CPA-advisory scenario.
 * Per-template UI forms (build plan §9.12) land in Phase 11; this
 * file is the calculation surface.
 *
 * Templates landing in Phase 9 core:
 *   - Bond pricing + yield-to-maturity (§9.3)
 *   - ASC 842 / IFRS 16 lease PV capitalization (§9.4)
 *   - IRR / NPV / MIRR over arbitrary irregular cash flows (§9.11)
 *   - Sinking fund (§9.8)
 *
 * Deferred:
 *   - §9.1 / §9.2 loan amortization + balloon — already covered
 *     directly by generateSchedule() in Phase 7
 *   - §9.5 TDR PV-of-future-cash-flows
 *   - §9.6 / §9.7 imputed interest + below-market loan — depend on
 *     Phase 22 AFR fetching
 *   - §9.9 lease rate factor / implicit rate solver
 *   - §9.10 note buy/sell yield
 */

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

// ---------------------------------------------------------------------
// 9.3 Bond pricing + yield-to-maturity
// ---------------------------------------------------------------------

export interface BondInput {
  /** Face value (par). */
  face: Money;
  /** Annual coupon rate (e.g. 0.05 for 5%). */
  couponRate: Rate;
  /** Coupon payments per year (1=annual, 2=semi-annual, 4=quarterly). */
  paymentsPerYear: number;
  /** Settlement date (today). */
  settle: Date;
  /** Maturity date. */
  maturity: Date;
  /** Required yield (annual nominal) — for clean/dirty price calc. */
  yieldRate?: Rate;
  /** Day-count convention; default 30/360. */
  dayCount?: DayCountConvention;
}

export interface BondPriceResult {
  cleanPrice: Money;
  dirtyPrice: Money;
  accruedInterest: Money;
}

/**
 * Bond price given a target yield. Returns clean (quoted) price,
 * dirty (full settlement) price, and accrued interest from last
 * coupon date to settle.
 */
export function priceBond(input: BondInput): BondPriceResult {
  if (!input.yieldRate) {
    throw new Error("priceBond requires yieldRate");
  }
  const dc = input.dayCount ?? "30/360";
  const couponPerPeriod = input.face.times(input.couponRate).div(input.paymentsPerYear);
  const yieldPerPeriod = input.yieldRate.div(input.paymentsPerYear);

  // Generate coupon dates from settle forward to maturity.
  const couponDates: Date[] = [];
  let cursor = new Date(input.maturity);
  while (cursor.getTime() > input.settle.getTime()) {
    couponDates.push(new Date(cursor));
    // Step back by one period.
    cursor = stepBackByPeriod(cursor, input.paymentsPerYear);
  }
  // The previous coupon date (might be before settle).
  const prevCouponDate = cursor;
  couponDates.reverse();

  // Year-fraction from settle to each coupon (in periods).
  const periodsToFirstCoupon = yearFraction(prevCouponDate, input.settle, dc)
    .times(input.paymentsPerYear)
    .negated()
    .plus(1);

  let dirty = ZERO;
  for (let k = 0; k < couponDates.length; k++) {
    const period = periodsToFirstCoupon.plus(k);
    const cf = k === couponDates.length - 1 ? couponPerPeriod.plus(input.face) : couponPerPeriod;
    dirty = dirty.plus(cf.div(ONE.plus(yieldPerPeriod).pow(period)));
  }

  const accrued = couponPerPeriod.times(
    yearFraction(prevCouponDate, input.settle, dc).times(input.paymentsPerYear),
  );
  const clean = dirty.minus(accrued);

  return {
    cleanPrice: money(clean),
    dirtyPrice: money(dirty),
    accruedInterest: money(accrued),
  };
}

/**
 * Yield-to-maturity given a market clean price. Solves for the yield
 * that reproduces the supplied clean price.
 */
export function bondYield(input: Omit<BondInput, "yieldRate"> & { cleanPrice: Money }): Rate {
  const dc = input.dayCount ?? "30/360";
  const couponPerPeriod = input.face.times(input.couponRate).div(input.paymentsPerYear);

  // Setup: build the cash-flow stream of (period, amount) pairs.
  const couponDates: Date[] = [];
  let cursor = new Date(input.maturity);
  while (cursor.getTime() > input.settle.getTime()) {
    couponDates.push(new Date(cursor));
    cursor = stepBackByPeriod(cursor, input.paymentsPerYear);
  }
  const prevCouponDate = cursor;
  couponDates.reverse();
  const periodsToFirstCoupon = yearFraction(prevCouponDate, input.settle, dc)
    .times(input.paymentsPerYear)
    .negated()
    .plus(1);

  const accrued = couponPerPeriod.times(
    yearFraction(prevCouponDate, input.settle, dc).times(input.paymentsPerYear),
  );
  const dirtyTarget = input.cleanPrice.plus(accrued);

  // Use a simple bisection over yieldPerPeriod ∈ (-0.99, 1.0) since
  // we have an explicit target and the function is monotonic in i.
  function pvAt(yieldPerPeriod: Decimal): Decimal {
    let pv = ZERO;
    for (let k = 0; k < couponDates.length; k++) {
      const period = periodsToFirstCoupon.plus(k);
      const cf = k === couponDates.length - 1 ? couponPerPeriod.plus(input.face) : couponPerPeriod;
      pv = pv.plus(cf.div(ONE.plus(yieldPerPeriod).pow(period)));
    }
    return pv.minus(dirtyTarget);
  }

  let lo = new Decimal("-0.5");
  let hi = new Decimal("1.0");
  for (let iter = 0; iter < 100; iter++) {
    const mid = lo.plus(hi).div(2);
    const fMid = pvAt(mid);
    if (fMid.abs().lt("1e-10") || hi.minus(lo).lt("1e-12")) {
      return rate(mid.times(input.paymentsPerYear));
    }
    const fLo = pvAt(lo);
    if (fMid.times(fLo).lt(0)) hi = mid;
    else lo = mid;
  }
  return rate(lo.plus(hi).div(2).times(input.paymentsPerYear));
}

function stepBackByPeriod(d: Date, paymentsPerYear: number): Date {
  const monthsBack = Math.round(12 / paymentsPerYear);
  const y = d.getUTCFullYear();
  const m0 = d.getUTCMonth() - monthsBack;
  const targetY = y + Math.floor(m0 / 12);
  const targetM0 = ((m0 % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(targetY, targetM0 + 1, 0)).getUTCDate());
  return new Date(Date.UTC(targetY, targetM0, day));
}

// ---------------------------------------------------------------------
// 9.4 ASC 842 / IFRS 16 lease present-value
// ---------------------------------------------------------------------

export interface Asc842Input {
  /** Lease payment amount per period. */
  paymentAmount: Money;
  /** Total number of payments. */
  numberOfPayments: number;
  /** Payments per year. */
  paymentsPerYear: number;
  /** Discount rate (annual nominal — typically the lessee's
   *  incremental borrowing rate or implicit rate when known). */
  discountRate: Rate;
  /** Initial direct costs the lessee capitalizes. */
  initialDirectCosts?: Money;
  /** Lease incentives received from lessor (reduce the ROU asset). */
  leaseIncentives?: Money;
  /** Prepayments made before commencement (added to ROU asset). */
  prepayments?: Money;
  /** Annuity due (1 = begin-of-period) for advance-rent leases. */
  paymentTiming?: 0 | 1;
}

export interface Asc842Result {
  /** PV of the lease payments at commencement. */
  leaseLiability: Money;
  /** ROU asset = liability + prepayments + idc - incentives. */
  rouAsset: Money;
}

export function asc842LeasePv(input: Asc842Input): Asc842Result {
  const periodicRate = input.discountRate.div(input.paymentsPerYear);
  const timing = input.paymentTiming ?? 0;
  let pv = ZERO;
  for (let k = 1; k <= input.numberOfPayments; k++) {
    const exponent = k - timing;
    pv = pv.plus(input.paymentAmount.div(ONE.plus(periodicRate).pow(exponent)));
  }
  const liability = pv;
  const rou = liability
    .plus(input.prepayments ?? ZERO)
    .plus(input.initialDirectCosts ?? ZERO)
    .minus(input.leaseIncentives ?? ZERO);
  return {
    leaseLiability: money(liability),
    rouAsset: money(rou),
  };
}

// ---------------------------------------------------------------------
// 9.11 IRR / NPV / MIRR
// ---------------------------------------------------------------------

export interface CashFlow {
  date: Date;
  amount: Money;
}

/**
 * Net Present Value over irregular cash flows. `discountRate` is
 * the annual rate; year-fractions use the supplied day-count
 * (default 30/360).
 */
export function npv(
  flows: CashFlow[],
  discountRate: Rate,
  dayCount: DayCountConvention = "30/360",
  baseDate?: Date,
): Money {
  if (flows.length === 0) return money("0");
  const t0 = baseDate ?? flows[0]!.date;
  let total = ZERO;
  for (const cf of flows) {
    const yf = yearFraction(t0, cf.date, dayCount);
    total = total.plus(cf.amount.div(ONE.plus(discountRate).pow(yf)));
  }
  return money(total);
}

/**
 * Internal Rate of Return: the annual rate that zeros NPV. Solves
 * via bisection over (-0.99, 5.0). Returns null when no root in
 * that bracket (sign-error inputs).
 */
export function irr(flows: CashFlow[], dayCount: DayCountConvention = "30/360"): Rate | null {
  if (flows.length < 2) return null;
  const t0 = flows[0]!.date;

  function npvAt(r: Decimal): Decimal {
    let total = ZERO;
    for (const cf of flows) {
      const yf = yearFraction(t0, cf.date, dayCount);
      total = total.plus(cf.amount.div(ONE.plus(r).pow(yf)));
    }
    return total;
  }

  let lo = new Decimal("-0.99");
  let hi = new Decimal("5.0");
  const fLo = npvAt(lo);
  const fHi = npvAt(hi);
  if (fLo.times(fHi).gt(0)) return null;
  for (let iter = 0; iter < 100; iter++) {
    const mid = lo.plus(hi).div(2);
    const fMid = npvAt(mid);
    if (fMid.abs().lt("1e-10") || hi.minus(lo).lt("1e-12")) {
      return rate(mid);
    }
    if (fMid.times(npvAt(lo)).lt(0)) hi = mid;
    else lo = mid;
  }
  return rate(lo.plus(hi).div(2));
}

/**
 * Modified IRR: assumes negative cash flows are financed at
 * `financeRate` and positive cash flows are reinvested at
 * `reinvestRate`.
 */
export function mirr(
  flows: CashFlow[],
  financeRate: Rate,
  reinvestRate: Rate,
  dayCount: DayCountConvention = "30/360",
): Rate {
  if (flows.length < 2) {
    throw new Error("mirr requires at least 2 cash flows");
  }
  const t0 = flows[0]!.date;
  const tN = flows[flows.length - 1]!.date;
  const totalYears = yearFraction(t0, tN, dayCount);
  let pvNeg = ZERO;
  let fvPos = ZERO;
  for (const cf of flows) {
    if (cf.amount.lt(0)) {
      const yf = yearFraction(t0, cf.date, dayCount);
      pvNeg = pvNeg.plus(cf.amount.div(ONE.plus(financeRate).pow(yf)));
    } else if (cf.amount.gt(0)) {
      const yf = yearFraction(cf.date, tN, dayCount);
      fvPos = fvPos.plus(cf.amount.times(ONE.plus(reinvestRate).pow(yf)));
    }
  }
  // MIRR = (FV / |PV|)^(1/n) − 1
  const ratio = fvPos.div(pvNeg.abs());
  const r = ratio.pow(ONE.div(totalYears)).minus(1);
  return rate(r);
}

// ---------------------------------------------------------------------
// 9.8 Sinking fund
// ---------------------------------------------------------------------

export interface SinkingFundInput {
  /** Target future value at the end of the term. */
  targetFV: Money;
  /** Annual nominal rate. */
  rate: Rate;
  /** Total periods. */
  numberOfPeriods: number;
  /** Periods per year (e.g. 12 for monthly contributions). */
  paymentsPerYear: number;
  /** Annuity due (1) for begin-of-period contributions. */
  paymentTiming?: 0 | 1;
}

export interface SinkingFundResult {
  /** Required deposit per period. */
  requiredDeposit: Money;
  /** Total contributions over the term (deposits × n). */
  totalContributions: Money;
  /** Interest earned = targetFV − totalContributions. */
  interestEarned: Money;
}

/**
 * Sinking fund: required periodic deposit to reach a future value.
 * Closed-form using the future-value-of-an-annuity factor.
 */
export function sinkingFund(input: SinkingFundInput): SinkingFundResult {
  const i = input.rate.div(input.paymentsPerYear);
  const n = input.numberOfPeriods;
  const timing = input.paymentTiming ?? 0;
  let factor: Decimal;
  if (i.eq(0)) {
    factor = new Decimal(n);
  } else {
    factor = ONE.plus(i)
      .pow(n)
      .minus(1)
      .div(i)
      .times(ONE.plus(i.times(timing)));
  }
  const deposit = input.targetFV.div(factor);
  const totalContributions = deposit.times(n);
  const interestEarned = input.targetFV.minus(totalContributions);
  return {
    requiredDeposit: money(deposit),
    totalContributions: money(totalContributions),
    interestEarned: money(interestEarned),
  };
}

// Re-export solveForI so consumers can build their own solve-for-rate
// templates without re-importing.
export { solveForI };
