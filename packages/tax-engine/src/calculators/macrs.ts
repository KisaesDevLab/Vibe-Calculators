import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import {
  adsHalfYearSchedule,
  gdsHalfYearTable,
  nonresidentialRealSchedule,
  residentialRentalSchedule,
  type GdsPropertyClass,
} from "../lib/macrs-tables.js";

/**
 * Phase 16.1 — MACRS depreciation schedule.
 *
 * Implements GDS half-year (3/5/7/10/15/20-year), GDS mid-month
 * (27.5 residential rental, 39 nonresidential real), and an ADS
 * straight-line option. Mid-quarter convention is intentionally
 * deferred — used in <5% of returns and adds 4× the table volume;
 * tracked for a follow-up phase.
 *
 * Switch-to-straight-line is implicit in the published Pub 946
 * tables (the percentages already encode the optimal switch point),
 * so we don't need to compute it separately.
 *
 * Output is a year-by-year schedule plus end-of-year basis. Pub 946
 * Appendix A worked examples are the acceptance benchmark.
 */

const propertyClassSchema = z.enum(["3", "5", "7", "10", "15", "20", "27.5", "39"]);

const inputSchema = z
  .object({
    /** Original cost basis after Section 179 + bonus reductions. */
    basis: z.number().positive().finite(),
    /** GDS class (3/5/7/10/15/20-year personal) or 27.5/39 real. */
    propertyClass: propertyClassSchema,
    /** Year the asset was placed in service (1900..2100). */
    placedInServiceYear: z.number().int().min(1900).max(2100),
    /**
     * Month placed in service (1-12). Required for 27.5 / 39 (mid-
     * month convention). Ignored for personal property (half-year
     * convention is mandatory at scope of MVP).
     */
    placedInServiceMonth: z.number().int().min(1).max(12).optional(),
    /** Use ADS straight-line instead of GDS. Default false. */
    useAds: z.boolean().default(false),
    /** ADS class life override. Required if useAds=true. */
    adsLifeYears: z.number().positive().finite().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const isReal = input.propertyClass === "27.5" || input.propertyClass === "39";
    if (isReal && input.placedInServiceMonth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placedInServiceMonth"],
        message: "placedInServiceMonth is required for 27.5/39-year real property",
      });
    }
    if (input.useAds && input.adsLifeYears === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adsLifeYears"],
        message: "adsLifeYears is required when useAds=true",
      });
    }
  });

type Input = z.infer<typeof inputSchema>;

const yearRowSchema = z.object({
  year: z.number().int(),
  percentage: z.number(),
  depreciation: z.number(),
  accumulatedDepreciation: z.number(),
  endOfYearBasis: z.number(),
});

const outputSchema = z.object({
  method: z.enum(["GDS-half-year", "GDS-mid-month", "ADS-straight-line"]),
  schedule: z.array(yearRowSchema),
  totalDepreciation: z.number(),
});

type Output = z.infer<typeof outputSchema>;

function pctScheduleFor(input: Input): { method: Output["method"]; pcts: readonly number[] } {
  if (input.useAds) {
    if (input.adsLifeYears === undefined) throw new Error("unreachable");
    return { method: "ADS-straight-line", pcts: adsHalfYearSchedule(input.adsLifeYears) };
  }
  if (input.propertyClass === "27.5") {
    if (input.placedInServiceMonth === undefined) throw new Error("unreachable");
    return {
      method: "GDS-mid-month",
      pcts: residentialRentalSchedule(input.placedInServiceMonth),
    };
  }
  if (input.propertyClass === "39") {
    if (input.placedInServiceMonth === undefined) throw new Error("unreachable");
    return {
      method: "GDS-mid-month",
      pcts: nonresidentialRealSchedule(input.placedInServiceMonth),
    };
  }
  return {
    method: "GDS-half-year",
    pcts: gdsHalfYearTable(input.propertyClass as GdsPropertyClass),
  };
}

const macrs: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.macrs",
    name: "MACRS depreciation",
    description:
      "Year-by-year MACRS depreciation schedule under GDS (half-year for personal, mid-month for real) or ADS straight-line. Per IRS Pub 946 Appendix A.",
    taxYears: [2024, 2025],
    formReferences: ["Form 4562", "Pub 946"],
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
    const { method, pcts } = pctScheduleFor(input);
    const basis = new Decimal(input.basis);
    const schedule: Output["schedule"] = [];
    let cumulative = new Decimal(0);

    for (let i = 0; i < pcts.length; i++) {
      const pct = pcts[i] ?? 0;
      const dep = basis.times(pct).div(100).toDecimalPlaces(2);
      cumulative = cumulative.plus(dep);
      // Last row: pin cumulative exactly to basis to avoid rounding drift.
      const isLast = i === pcts.length - 1;
      const finalCumulative = isLast ? basis : cumulative;
      const finalDep = isLast ? finalCumulative.minus(cumulative.minus(dep)) : dep;
      const eoyBasis = basis.minus(finalCumulative);
      schedule.push({
        year: input.placedInServiceYear + i,
        percentage: pct,
        depreciation: finalDep.toNumber(),
        accumulatedDepreciation: finalCumulative.toNumber(),
        endOfYearBasis: eoyBasis.toNumber(),
      });
      if (isLast) cumulative = finalCumulative;
    }

    return {
      method,
      schedule,
      totalDepreciation: cumulative.toNumber(),
    };
  },
  narrate(input, output) {
    const last = output.schedule[output.schedule.length - 1];
    const lastYear = last?.year ?? input.placedInServiceYear;
    return (
      `MACRS ${output.method} on a $${input.basis.toLocaleString("en-US")} ` +
      `${input.propertyClass}-year asset placed in service in ${input.placedInServiceYear}: ` +
      `total depreciation $${output.totalDepreciation.toLocaleString("en-US")} ` +
      `recovered over ${output.schedule.length} years (through ${lastYear}).`
    );
  },
};

registerCalculator(macrs);

export { macrs };
