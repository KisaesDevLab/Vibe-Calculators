import Decimal from "decimal.js";
import { money, rate, type Money, type Rate } from "./types.js";
import { solveForI, type SolverResult } from "./tvm-solver.js";

/**
 * Phase 8 — Regulation Z (Truth-in-Lending) APR + disclosure.
 *
 * Reg Z 12 CFR §1026 governs consumer-credit disclosures. The APR
 * is the rate that makes the present value of the payment stream
 * equal the amount financed (principal received minus prepaid
 * finance charges). Per Appendix J, computation uses the actuarial
 * method (US Rule) over the unit-period.
 *
 * Phase 8 implements the math + disclosure builder. PDF rendering
 * and the official-commentary regression fixtures are deferred.
 */

// ---------------------------------------------------------------------
// Phase 8.2 — finance-charge classification
// ---------------------------------------------------------------------

export type FinanceChargeKind = "prepaid" | "interest" | "financed";

export interface FinanceCharge {
  /** Stable identifier, useful for disclosure rendering. */
  id: string;
  description: string;
  kind: FinanceChargeKind;
  amount: Money;
}

export interface ClassifiedFinanceCharges {
  totalFinanceCharge: Money;
  prepaid: Money;
  interest: Money;
  financed: Money;
}

export function classifyFinanceCharges(charges: FinanceCharge[]): ClassifiedFinanceCharges {
  let prepaid = new Decimal(0);
  let interest = new Decimal(0);
  let financed = new Decimal(0);
  for (const c of charges) {
    if (c.kind === "prepaid") prepaid = prepaid.plus(c.amount);
    else if (c.kind === "interest") interest = interest.plus(c.amount);
    else if (c.kind === "financed") financed = financed.plus(c.amount);
  }
  const total = prepaid.plus(interest).plus(financed);
  return {
    totalFinanceCharge: money(total),
    prepaid: money(prepaid),
    interest: money(interest),
    financed: money(financed),
  };
}

// ---------------------------------------------------------------------
// Phase 8.1 / 8.3 — Amount Financed + APR computation
// ---------------------------------------------------------------------

export interface AprInput {
  /** Cash actually disbursed to the borrower (loan proceeds). */
  loanProceeds: Money;
  /** Periodic payment amount (positive number; sign handled internally). */
  paymentAmount: Money;
  /** Number of equal payments. */
  numberOfPayments: number;
  /** Periods per year — e.g. 12 for monthly, 52 for weekly. */
  paymentsPerYear: number;
  /** Prepaid finance charges (deducted from amount financed). */
  prepaidFinanceCharges: Money;
  /** Optional balloon at the end. */
  balloonAmount?: Money;
  /** Annuity-due (1) for begin-of-period payments, 0 for end (default). */
  paymentTiming?: 0 | 1;
}

export interface AprResult {
  /** Annual percentage rate (effective annual when periodsPerYear=1). */
  apr: Rate;
  /** Periodic rate that solves the equation (apr / paymentsPerYear). */
  periodicRate: Rate;
  amountFinanced: Money;
  totalOfPayments: Money;
  /** Reg Z §1026.18(b): finance charge = total of payments − amount financed. */
  totalFinanceCharge: Money;
  iterations: number;
  /** Tolerance verdict per Reg Z §1026.22(a): ±0.125% (regular) or ±0.25% (irregular). */
  withinTolerance: {
    regular: boolean;
    irregular: boolean;
    /** APR difference vs the supplied target, if any. Null when no target was given. */
    deltaPct: Decimal | null;
  };
}

export class AprComputationError extends Error {
  constructor(public readonly result: SolverResult) {
    super(
      `APR could not be solved: ${result.ok ? "n/a" : result.reason} (iterations: ${result.iterations})`,
    );
    this.name = "AprComputationError";
  }
}

const DEFAULT_TOLERANCE_REGULAR = new Decimal("0.00125"); // 0.125% / 100
const DEFAULT_TOLERANCE_IRREGULAR = new Decimal("0.0025"); // 0.25% / 100

/**
 * Phase 8.1 — compute APR by solving for the periodic rate that
 * balances the canonical TVM equation:
 *
 *   amountFinanced = sum(payment / (1+i)^k for k in 1..n) + balloon/(1+i)^n
 *
 * which we recast into TVM form: PV = amountFinanced (positive,
 * cash inflow), PMT = -payment (outflow), FV = -balloon, type=0|1.
 *
 * The annual APR is `periodicRate * paymentsPerYear` per Reg Z
 * §1026.22(a) "actuarial method" — APR is reported as a simple
 * (nominal) annual rate.
 */
export function computeApr(input: AprInput, targetApr?: Rate): AprResult {
  const amountFinanced = input.loanProceeds.minus(input.prepaidFinanceCharges);
  const totalPayments = input.paymentAmount.times(input.numberOfPayments);
  const balloon = input.balloonAmount ?? new Decimal(0);
  const totalOfPayments = money(totalPayments.plus(balloon));
  const totalFinanceCharge = money(totalOfPayments.minus(amountFinanced));
  const timing = input.paymentTiming ?? 0;

  const solverResult = solveForI({
    pv: amountFinanced,
    fv: balloon.negated() as Decimal, // owed at end → outflow at t=n
    pmt: input.paymentAmount.negated() as Decimal,
    n: new Decimal(input.numberOfPayments),
    type: timing,
  });
  if (!solverResult.ok) {
    throw new AprComputationError(solverResult);
  }

  const periodicRate = solverResult.value;
  const apr = rate(periodicRate.times(input.paymentsPerYear));

  const deltaPct: Decimal | null = targetApr ? apr.minus(targetApr) : null;
  const within = (allowed: Decimal): boolean =>
    deltaPct === null ? true : (deltaPct as Decimal).abs().lte(allowed);

  return {
    apr,
    periodicRate,
    amountFinanced: money(amountFinanced),
    totalOfPayments,
    totalFinanceCharge,
    iterations: solverResult.iterations,
    withinTolerance: {
      regular: within(DEFAULT_TOLERANCE_REGULAR),
      irregular: within(DEFAULT_TOLERANCE_IRREGULAR),
      deltaPct,
    },
  };
}

// ---------------------------------------------------------------------
// Phase 8.4 — disclosure builder
// ---------------------------------------------------------------------

export interface RegZDisclosure {
  /** APR as a fraction (0.075 = 7.5%). */
  apr: Rate;
  amountFinanced: Money;
  financeCharge: Money;
  totalOfPayments: Money;
  /** Per Reg Z §1026.18(g): payment schedule. */
  paymentSchedule: { number: number; amount: Money; dueDate?: Date | undefined }[];
  /** Late-charge terms text (operator-supplied). */
  lateChargeText?: string;
  /** Prepayment penalty / refund terms text. */
  prepaymentText?: string;
  /** Security-interest description. */
  securityInterestText?: string;
  /** Assumability terms ('not assumable' / 'assumable subject to...'). */
  assumabilityText?: string;
  /** Required-deposit advisory ('Y%' / null). */
  requiredDepositText?: string;
  /** Underlying APR identity check. */
  identityCheck: { passes: boolean; difference: Money };
}

export interface DisclosureBuilderInput extends AprInput {
  paymentDates?: Date[];
  lateChargeText?: string;
  prepaymentText?: string;
  securityInterestText?: string;
  assumabilityText?: string;
  requiredDepositText?: string;
}

export function buildRegZDisclosure(input: DisclosureBuilderInput): RegZDisclosure {
  const aprResult = computeApr(input);
  // Identity: total of payments − amount financed = finance charge
  const identityDelta = aprResult.totalOfPayments
    .minus(aprResult.amountFinanced)
    .minus(aprResult.totalFinanceCharge);
  const passes = identityDelta.abs().lt("0.005");

  const dates = input.paymentDates ?? [];
  const schedule: RegZDisclosure["paymentSchedule"] = [];
  for (let k = 1; k <= input.numberOfPayments; k++) {
    const entry: { number: number; amount: Money; dueDate?: Date } = {
      number: k,
      amount: input.paymentAmount,
    };
    const dueDate = dates[k - 1];
    if (dueDate) entry.dueDate = dueDate;
    schedule.push(entry);
  }
  if (input.balloonAmount && input.balloonAmount.gt(0)) {
    const last = schedule[schedule.length - 1];
    if (last) last.amount = money(last.amount.plus(input.balloonAmount));
  }

  return {
    apr: aprResult.apr,
    amountFinanced: aprResult.amountFinanced,
    financeCharge: aprResult.totalFinanceCharge,
    totalOfPayments: aprResult.totalOfPayments,
    paymentSchedule: schedule,
    ...(input.lateChargeText !== undefined && { lateChargeText: input.lateChargeText }),
    ...(input.prepaymentText !== undefined && { prepaymentText: input.prepaymentText }),
    ...(input.securityInterestText !== undefined && {
      securityInterestText: input.securityInterestText,
    }),
    ...(input.assumabilityText !== undefined && { assumabilityText: input.assumabilityText }),
    ...(input.requiredDepositText !== undefined && {
      requiredDepositText: input.requiredDepositText,
    }),
    identityCheck: { passes, difference: money(identityDelta) },
  };
}
