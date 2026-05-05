import { z } from "zod";
import {
  priceBond,
  bondYield,
  asc842LeasePv,
  npv,
  irr,
  mirr,
  sinkingFund,
  money,
  rate,
} from "@vibe-calc/calc-engine";
import {
  registerCalculator,
  type TaxCalculator,
  type ValidationResult,
} from "@vibe-calc/tax-engine";

/**
 * Phase 9 / 15 — TVM templates exposed via the Calculator registry.
 *
 * The seven calc-engine templates were previously engine-only. This
 * module wraps each in the same TaxCalculator<I,O> shape so they
 * surface in:
 *   - GET /api/v1/calculators (registry catalog)
 *   - the web calculator picker
 *   - the auto-form generator
 *
 * Each wrapper validates a primitive-typed input via Zod, converts
 * numbers to the calc-engine's branded Money / Rate types (under
 * the hood: Decimal.js), runs the underlying template, returns
 * primitives back out for JSON-friendly transport.
 */

// Helpers — coerce primitive numbers to/from the calc-engine's branded types.
// Use the engine's money() / rate() factories rather than constructing
// Decimal directly, both for brand correctness and to avoid the
// CJS/ESM Decimal default-export quirk under moduleResolution: NodeNext.
const num = (d: unknown): number => (d as { toNumber(): number }).toNumber();
const dayCounts = z.enum(["30/360", "30/360-US", "30/365", "ACT/365", "ACT/360", "ACT/ACT-ISDA"]);

// ---------------------------------------------------------------------
// Bond price
// ---------------------------------------------------------------------

const bondPriceInput = z.object({
  face: z.number().positive().finite(),
  couponRate: z.number().min(0).max(1),
  yieldRate: z.number().min(0).max(1),
  paymentsPerYear: z.number().int().positive().default(2),
  settleDate: z.string(),
  maturityDate: z.string(),
  dayCount: dayCounts.default("30/360"),
});
type BondPriceI = z.infer<typeof bondPriceInput>;
const bondPriceOutput = z.object({
  cleanPrice: z.number(),
  dirtyPrice: z.number(),
  accruedInterest: z.number(),
});
type BondPriceO = z.infer<typeof bondPriceOutput>;

const bondPriceCalc: TaxCalculator<BondPriceI, BondPriceO> = {
  metadata: {
    kind: "tvm.bond-price",
    name: "Bond price",
    description: "Compute clean price, dirty price, and accrued interest for a fixed-coupon bond.",
    taxYears: [],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema: bondPriceInput,
  outputSchema: bondPriceOutput,
  validateInputs(raw): ValidationResult<BondPriceI> {
    const r = bondPriceInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const result = priceBond({
      face: money(input.face),
      couponRate: rate(input.couponRate),
      yieldRate: rate(input.yieldRate),
      paymentsPerYear: input.paymentsPerYear,
      settle: new Date(input.settleDate),
      maturity: new Date(input.maturityDate),
      dayCount: input.dayCount,
    });
    return {
      cleanPrice: num(result.cleanPrice),
      dirtyPrice: num(result.dirtyPrice),
      accruedInterest: num(result.accruedInterest),
    };
  },
  narrate(input, output) {
    return `At a ${(input.yieldRate * 100).toFixed(3)}% yield, a bond paying a ${(input.couponRate * 100).toFixed(3)}% coupon (${input.paymentsPerYear}× per year) on $${input.face.toLocaleString()} face from ${input.settleDate} to ${input.maturityDate} has a clean price of $${output.cleanPrice.toFixed(2)} and accrued interest of $${output.accruedInterest.toFixed(2)} (dirty: $${output.dirtyPrice.toFixed(2)}).`;
  },
};

// ---------------------------------------------------------------------
// Bond yield (YTM)
// ---------------------------------------------------------------------

const bondYieldInput = z.object({
  face: z.number().positive().finite(),
  couponRate: z.number().min(0).max(1),
  cleanPrice: z.number().positive().finite(),
  paymentsPerYear: z.number().int().positive().default(2),
  settleDate: z.string(),
  maturityDate: z.string(),
  dayCount: dayCounts.default("30/360"),
});
type BondYieldI = z.infer<typeof bondYieldInput>;
const bondYieldOutput = z.object({ yieldToMaturity: z.number() });
type BondYieldO = z.infer<typeof bondYieldOutput>;

const bondYieldCalc: TaxCalculator<BondYieldI, BondYieldO> = {
  metadata: {
    kind: "tvm.bond-yield",
    name: "Bond yield (YTM)",
    description: "Solve for yield-to-maturity given clean price.",
    taxYears: [],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema: bondYieldInput,
  outputSchema: bondYieldOutput,
  validateInputs(raw): ValidationResult<BondYieldI> {
    const r = bondYieldInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const ytm = bondYield({
      face: money(input.face),
      couponRate: rate(input.couponRate),
      cleanPrice: money(input.cleanPrice),
      paymentsPerYear: input.paymentsPerYear,
      settle: new Date(input.settleDate),
      maturity: new Date(input.maturityDate),
      dayCount: input.dayCount,
    });
    return { yieldToMaturity: num(ytm) };
  },
  narrate(input, output) {
    return `A bond with $${input.face.toLocaleString()} face and a ${(input.couponRate * 100).toFixed(3)}% coupon trading at $${input.cleanPrice.toFixed(2)} (clean) yields ${(output.yieldToMaturity * 100).toFixed(4)}% to maturity.`;
  },
};

// ---------------------------------------------------------------------
// ASC 842 / IFRS 16 lease present-value
// ---------------------------------------------------------------------

const leaseInput = z.object({
  paymentAmount: z.number().positive().finite(),
  numberOfPayments: z.number().int().positive(),
  paymentsPerYear: z.number().int().positive().default(12),
  discountRate: z.number().min(0).max(1),
  paymentTiming: z.union([z.literal(0), z.literal(1)]).default(1),
  initialDirectCosts: z.number().min(0).default(0),
  prepayments: z.number().min(0).default(0),
  leaseIncentives: z.number().min(0).default(0),
});
type LeaseI = z.infer<typeof leaseInput>;
const leaseOutput = z.object({ leaseLiability: z.number(), rouAsset: z.number() });
type LeaseO = z.infer<typeof leaseOutput>;

const leaseCalc: TaxCalculator<LeaseI, LeaseO> = {
  metadata: {
    kind: "tvm.asc842-lease",
    name: "ASC 842 / IFRS 16 lease",
    description:
      "Capitalize an operating or finance lease: PV the payment stream at the discount rate, then build the right-of-use asset.",
    taxYears: [],
    formReferences: ["ASC 842", "IFRS 16"],
    requiredTables: [],
  },
  inputSchema: leaseInput,
  outputSchema: leaseOutput,
  validateInputs(raw): ValidationResult<LeaseI> {
    const r = leaseInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const result = asc842LeasePv({
      paymentAmount: money(input.paymentAmount),
      numberOfPayments: input.numberOfPayments,
      paymentsPerYear: input.paymentsPerYear,
      discountRate: rate(input.discountRate),
      paymentTiming: input.paymentTiming,
      initialDirectCosts: money(input.initialDirectCosts),
      prepayments: money(input.prepayments),
      leaseIncentives: money(input.leaseIncentives),
    });
    return {
      leaseLiability: num(result.leaseLiability),
      rouAsset: num(result.rouAsset),
    };
  },
  narrate(input, output) {
    return `Lease of $${input.paymentAmount.toFixed(2)} × ${input.numberOfPayments} payments (${input.paymentsPerYear}× per year) at a ${(input.discountRate * 100).toFixed(3)}% discount rate produces a lease liability of $${output.leaseLiability.toFixed(2)} and a right-of-use asset of $${output.rouAsset.toFixed(2)}.`;
  },
};

// ---------------------------------------------------------------------
// NPV / IRR / MIRR
// ---------------------------------------------------------------------

const flowsField = z.array(z.object({ date: z.string(), amount: z.number().finite() })).min(2);

const npvInput = z.object({
  flows: flowsField,
  discountRate: z.number().min(-1).max(1),
  dayCount: dayCounts.default("30/360"),
});
type NpvI = z.infer<typeof npvInput>;
const npvOutput = z.object({ npv: z.number() });
type NpvO = z.infer<typeof npvOutput>;

const npvCalc: TaxCalculator<NpvI, NpvO> = {
  metadata: {
    kind: "tvm.npv",
    name: "NPV",
    description: "Net present value of an irregular cash-flow stream.",
    taxYears: [],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema: npvInput,
  outputSchema: npvOutput,
  validateInputs(raw): ValidationResult<NpvI> {
    const r = npvInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const flows = input.flows.map((f) => ({
      date: new Date(f.date),
      amount: money(f.amount),
    }));
    const result = npv(flows, rate(input.discountRate), input.dayCount);
    return { npv: num(result) };
  },
  narrate(input, output) {
    return `${input.flows.length} cash flows discounted at ${(input.discountRate * 100).toFixed(3)}% (${input.dayCount}) yield an NPV of $${output.npv.toFixed(2)}.`;
  },
};

const irrInput = z.object({
  flows: flowsField,
  dayCount: dayCounts.default("30/360"),
});
type IrrI = z.infer<typeof irrInput>;
const irrOutput = z.object({ irr: z.number().nullable() });
type IrrO = z.infer<typeof irrOutput>;

const irrCalc: TaxCalculator<IrrI, IrrO> = {
  metadata: {
    kind: "tvm.irr",
    name: "IRR",
    description:
      "Internal rate of return on an irregular cash-flow stream. Null when the solver does not converge.",
    taxYears: [],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema: irrInput,
  outputSchema: irrOutput,
  validateInputs(raw): ValidationResult<IrrI> {
    const r = irrInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const flows = input.flows.map((f) => ({
      date: new Date(f.date),
      amount: money(f.amount),
    }));
    const result = irr(flows, input.dayCount);
    return { irr: result === null ? null : num(result) };
  },
  narrate(input, output) {
    if (output.irr === null)
      return `${input.flows.length} cash flows — IRR could not be computed (likely no sign change in flows).`;
    return `${input.flows.length} cash flows have an internal rate of return of ${(output.irr * 100).toFixed(4)}% (${input.dayCount}).`;
  },
};

const mirrInput = z.object({
  flows: flowsField,
  financeRate: z.number().min(-1).max(1),
  reinvestRate: z.number().min(-1).max(1),
  dayCount: dayCounts.default("30/360"),
});
type MirrI = z.infer<typeof mirrInput>;
const mirrOutput = z.object({ mirr: z.number() });
type MirrO = z.infer<typeof mirrOutput>;

const mirrCalc: TaxCalculator<MirrI, MirrO> = {
  metadata: {
    kind: "tvm.mirr",
    name: "MIRR",
    description:
      "Modified internal rate of return — separates the finance rate (for outflows) from the reinvestment rate (for inflows).",
    taxYears: [],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema: mirrInput,
  outputSchema: mirrOutput,
  validateInputs(raw): ValidationResult<MirrI> {
    const r = mirrInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const flows = input.flows.map((f) => ({
      date: new Date(f.date),
      amount: money(f.amount),
    }));
    const result = mirr(flows, rate(input.financeRate), rate(input.reinvestRate), input.dayCount);
    return { mirr: num(result) };
  },
  narrate(input, output) {
    return `Cash flows financed at ${(input.financeRate * 100).toFixed(3)}% and reinvested at ${(input.reinvestRate * 100).toFixed(3)}% have a modified IRR of ${(output.mirr * 100).toFixed(4)}%.`;
  },
};

// ---------------------------------------------------------------------
// Sinking fund
// ---------------------------------------------------------------------

const sinkingInput = z.object({
  targetFV: z.number().positive().finite(),
  rate: z.number().min(0).max(1),
  numberOfPeriods: z.number().int().positive(),
  paymentsPerYear: z.number().int().positive().default(12),
  paymentTiming: z.union([z.literal(0), z.literal(1)]).default(0),
});
type SinkingI = z.infer<typeof sinkingInput>;
const sinkingOutput = z.object({
  requiredDeposit: z.number(),
  totalContributions: z.number(),
  interestEarned: z.number(),
});
type SinkingO = z.infer<typeof sinkingOutput>;

const sinkingCalc: TaxCalculator<SinkingI, SinkingO> = {
  metadata: {
    kind: "tvm.sinking-fund",
    name: "Sinking fund",
    description:
      "Solve for the level deposit required each period to accumulate a target future value at a given rate.",
    taxYears: [],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema: sinkingInput,
  outputSchema: sinkingOutput,
  validateInputs(raw): ValidationResult<SinkingI> {
    const r = sinkingInput.safeParse(raw);
    return r.success
      ? { ok: true, value: r.data }
      : {
          ok: false,
          issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
  compute(input) {
    const result = sinkingFund({
      targetFV: money(input.targetFV),
      rate: rate(input.rate),
      numberOfPeriods: input.numberOfPeriods,
      paymentsPerYear: input.paymentsPerYear,
      paymentTiming: input.paymentTiming,
    });
    return {
      requiredDeposit: num(result.requiredDeposit),
      totalContributions: num(result.totalContributions),
      interestEarned: num(result.interestEarned),
    };
  },
  narrate(input, output) {
    return `To accumulate $${input.targetFV.toLocaleString()} in ${input.numberOfPeriods} periods at a ${(input.rate * 100).toFixed(3)}% annual rate (${input.paymentsPerYear}× per year), deposit $${output.requiredDeposit.toFixed(2)} per period. Total contributions: $${output.totalContributions.toFixed(2)}; growth from interest: $${output.interestEarned.toFixed(2)}.`;
  },
};

// ---------------------------------------------------------------------
// Side-effect — register all wrappers on the shared registry.
// Idempotent: calling twice is a no-op.
// ---------------------------------------------------------------------

let registered = false;
export function registerTvmCalculators(): void {
  if (registered) return;
  registered = true;
  registerCalculator(bondPriceCalc);
  registerCalculator(bondYieldCalc);
  registerCalculator(leaseCalc);
  registerCalculator(npvCalc);
  registerCalculator(irrCalc);
  registerCalculator(mirrCalc);
  registerCalculator(sinkingCalc);
}
