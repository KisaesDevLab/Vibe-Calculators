import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import { macrs } from "./macrs.js";

/**
 * Phase 16.5 — Cost-segregation impact estimator.
 *
 * Cost segregation breaks a building's depreciable basis into
 * shorter-life buckets (5-year personal property, 7-year furniture,
 * 15-year land improvements, 39-year nonresidential real) so the
 * shorter-life portions accelerate depreciation and produce a
 * year-1 lift.
 *
 * Output: per-bucket schedule + year-1 lift relative to "no cost
 * seg" (everything in 39-year bucket) + NPV at supplied discount.
 */

const inputSchema = z
  .object({
    /** Total depreciable basis after land allocation. */
    totalBasis: z.number().positive().finite(),
    /** Allocations summing to <= totalBasis (remainder → 39-year). */
    allocation5Year: z.number().nonnegative().finite().default(0),
    allocation7Year: z.number().nonnegative().finite().default(0),
    allocation15Year: z.number().nonnegative().finite().default(0),
    /** Year placed in service. */
    placedInServiceYear: z.number().int().min(1900).max(2100),
    /** Month placed in service (for the 39-year mid-month run). */
    placedInServiceMonth: z.number().int().min(1).max(12),
    /** Discount rate for NPV (decimal — 0.08 = 8%). */
    discountRate: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((input, ctx) => {
    const sum = input.allocation5Year + input.allocation7Year + input.allocation15Year;
    if (sum > input.totalBasis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocation5Year"],
        message: `Bucket allocations ($${sum}) exceed totalBasis ($${input.totalBasis})`,
      });
    }
  });

type Input = z.infer<typeof inputSchema>;

const bucketRowSchema = z.object({
  year: z.number().int(),
  bucket: z.enum(["5-year", "7-year", "15-year", "39-year"]),
  amount: z.number(),
});

const outputSchema = z.object({
  buckets: z.object({
    "5-year": z.number(),
    "7-year": z.number(),
    "15-year": z.number(),
    "39-year": z.number(),
  }),
  yearOneWithCostSeg: z.number(),
  yearOneWithoutCostSeg: z.number(),
  yearOneLift: z.number(),
  npvWithCostSeg: z.number(),
  npvWithoutCostSeg: z.number(),
  npvLift: z.number(),
  schedule: z.array(bucketRowSchema),
});

type Output = z.infer<typeof outputSchema>;

interface YearAmount {
  year: number;
  amount: Decimal;
}

function npv(cashFlows: YearAmount[], discountRate: number, baseYear: number): Decimal {
  const r = new Decimal(discountRate);
  return cashFlows.reduce((acc, cf) => {
    const t = cf.year - baseYear;
    const denom = new Decimal(1).plus(r).pow(t);
    return acc.plus(cf.amount.div(denom));
  }, new Decimal(0));
}

const costSegregation: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.cost_segregation",
    name: "Cost-segregation impact estimator",
    description:
      "Compares MACRS schedules with and without a cost-segregation study. Outputs year-1 lift, full schedule, and NPV at the supplied discount rate.",
    taxYears: [2024, 2025],
    formReferences: ["Pub 946 ch. 2", "Form 4562"],
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
  compute(input, ctx) {
    const total = new Decimal(input.totalBasis);
    const a5 = new Decimal(input.allocation5Year);
    const a7 = new Decimal(input.allocation7Year);
    const a15 = new Decimal(input.allocation15Year);
    const a39 = total.minus(a5).minus(a7).minus(a15);

    const runs = [
      {
        bucket: "5-year" as const,
        basis: a5,
        klass: "5" as const,
        month: undefined as number | undefined,
      },
      { bucket: "7-year" as const, basis: a7, klass: "7" as const, month: undefined },
      { bucket: "15-year" as const, basis: a15, klass: "15" as const, month: undefined },
      {
        bucket: "39-year" as const,
        basis: a39,
        klass: "39" as const,
        month: input.placedInServiceMonth,
      },
    ];

    const schedule: Output["schedule"] = [];
    const cashFlowsCS: YearAmount[] = [];
    let yearOneCS = new Decimal(0);
    for (const r of runs) {
      if (r.basis.lte(0)) continue;
      const macrsInput = r.month
        ? {
            basis: r.basis.toNumber(),
            propertyClass: r.klass,
            placedInServiceYear: input.placedInServiceYear,
            placedInServiceMonth: r.month,
            useAds: false,
          }
        : {
            basis: r.basis.toNumber(),
            propertyClass: r.klass,
            placedInServiceYear: input.placedInServiceYear,
            useAds: false,
          };
      const out = macrs.compute(macrsInput, ctx);
      for (const row of out.schedule) {
        schedule.push({ year: row.year, bucket: r.bucket, amount: row.depreciation });
        cashFlowsCS.push({ year: row.year, amount: new Decimal(row.depreciation) });
        if (row.year === input.placedInServiceYear) {
          yearOneCS = yearOneCS.plus(row.depreciation);
        }
      }
    }

    // Counterfactual: everything in 39-year bucket.
    const baseline = macrs.compute(
      {
        basis: total.toNumber(),
        propertyClass: "39",
        placedInServiceYear: input.placedInServiceYear,
        placedInServiceMonth: input.placedInServiceMonth,
        useAds: false,
      },
      ctx,
    );
    const cashFlowsBaseline: YearAmount[] = baseline.schedule.map((row) => ({
      year: row.year,
      amount: new Decimal(row.depreciation),
    }));
    const yearOneBaseline = new Decimal(baseline.schedule[0]?.depreciation ?? 0);

    const npvCS = npv(cashFlowsCS, input.discountRate, input.placedInServiceYear);
    const npvBase = npv(cashFlowsBaseline, input.discountRate, input.placedInServiceYear);

    return {
      buckets: {
        "5-year": a5.toNumber(),
        "7-year": a7.toNumber(),
        "15-year": a15.toNumber(),
        "39-year": a39.toNumber(),
      },
      yearOneWithCostSeg: yearOneCS.toNumber(),
      yearOneWithoutCostSeg: yearOneBaseline.toNumber(),
      yearOneLift: yearOneCS.minus(yearOneBaseline).toNumber(),
      npvWithCostSeg: npvCS.toNumber(),
      npvWithoutCostSeg: npvBase.toNumber(),
      npvLift: npvCS.minus(npvBase).toNumber(),
      schedule,
    };
  },
  narrate(input, output) {
    return (
      `Cost-segregation study on $${input.totalBasis.toLocaleString("en-US")} basis: ` +
      `5-year $${output.buckets["5-year"].toLocaleString("en-US")}, ` +
      `7-year $${output.buckets["7-year"].toLocaleString("en-US")}, ` +
      `15-year $${output.buckets["15-year"].toLocaleString("en-US")}, ` +
      `39-year $${output.buckets["39-year"].toLocaleString("en-US")}. ` +
      `Year-1 lift vs. no cost-seg: $${output.yearOneLift.toLocaleString("en-US")}. ` +
      `NPV lift @ ${(input.discountRate * 100).toFixed(2)}%: $${output.npvLift.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(costSegregation);

export { costSegregation };
