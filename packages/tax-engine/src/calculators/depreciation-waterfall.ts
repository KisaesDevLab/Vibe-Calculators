import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import { section179 } from "./section-179.js";
import { bonus168k } from "./bonus-168k.js";
import { macrs } from "./macrs.js";

/**
 * Phase 16.4 — Combined Section 179 + bonus + MACRS waterfall.
 *
 * IRS-required ordering (Pub 946 ch. 2):
 *   1. Section 179 election applied first to qualifying basis.
 *   2. Bonus depreciation (168(k)) on basis remaining after §179.
 *   3. MACRS on basis remaining after §179 + bonus.
 *
 * The single waterfall input form handles the most-common case
 * (single asset, single property class) so a CPA can plug in cost +
 * class + placed-in-service-date + business income and get one
 * consolidated schedule for the engagement.
 */

const inputSchema = z
  .object({
    cost: z.number().positive().finite(),
    propertyClass: z.enum(["3", "5", "7", "10", "15", "20", "27.5", "39"]),
    placedInServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    placedInServiceMonth: z.number().int().min(1).max(12).optional(),
    /** Aggregate business income for §179 limitation. */
    aggregateBusinessIncome: z.number().finite(),
    /** Tax year (driver for §179 limit + bonus pct). */
    taxYear: z.number().int().min(2024).max(2026),
    /** §179 amount the taxpayer ELECTS — defaults to "max possible". */
    electedSection179: z.number().nonnegative().finite().optional(),
    /** Heavy-SUV cost subject to SUV cap. */
    heavySuvCost: z.number().nonnegative().finite().default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("mfj"),
    mfsAllocation: z.number().min(0).max(1).default(0.5),
    electOutOfBonus: z.boolean().default(false),
    useAds: z.boolean().default(false),
    adsLifeYears: z.number().positive().finite().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const isReal = input.propertyClass === "27.5" || input.propertyClass === "39";
    if (isReal && input.placedInServiceMonth === undefined) {
      // Derive from date if not explicitly provided. Date string
      // is regex-validated above so this Date.UTC parse is safe.
      const d = new Date(`${input.placedInServiceDate}T00:00:00Z`);
      const month = d.getUTCMonth() + 1;
      if (!Number.isFinite(d.getTime()) || month < 1 || month > 12) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["placedInServiceMonth"],
          message: "placedInServiceMonth required (or derivable from placedInServiceDate)",
        });
      }
    }
  });

type Input = z.infer<typeof inputSchema>;

const yearRowSchema = z.object({
  year: z.number().int(),
  bucket: z.enum(["section179", "bonus", "macrs"]),
  amount: z.number(),
});

const outputSchema = z.object({
  electedSection179: z.number(),
  allowedSection179: z.number(),
  section179Carryforward: z.number(),
  bonusDepreciation: z.number(),
  bonusPctApplied: z.number(),
  basisAfter179AndBonus: z.number(),
  totalYearOneDeduction: z.number(),
  consolidatedSchedule: z.array(yearRowSchema),
  totalLifetimeDeduction: z.number(),
});

type Output = z.infer<typeof outputSchema>;

const waterfall: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.depreciation_waterfall",
    name: "§179 + bonus + MACRS waterfall",
    description:
      "Single-asset depreciation waterfall applying Section 179, then bonus depreciation, then MACRS in IRS-required order. Produces a consolidated year-by-year schedule.",
    taxYears: [2024, 2025],
    formReferences: ["Form 4562", "Pub 946"],
    requiredTables: ["section_179_limits", "bonus_depreciation_pct"],
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
    const cost = new Decimal(input.cost);
    const placedDate = new Date(`${input.placedInServiceDate}T00:00:00Z`);
    const placedYear = placedDate.getUTCFullYear();
    const monthFromDate = placedDate.getUTCMonth() + 1;
    const placedMonth = input.placedInServiceMonth ?? monthFromDate;

    // Step 1 — Section 179.
    const s179Out = section179.compute(
      {
        totalQualifyingCost: input.cost,
        heavySuvCost: input.heavySuvCost,
        aggregateBusinessIncome: input.aggregateBusinessIncome,
        filingStatus: input.filingStatus,
        mfsAllocation: input.mfsAllocation,
        taxYear: input.taxYear,
      },
      ctx,
    );
    const requestedElection = input.electedSection179 ?? s179Out.totalSection179;
    const electedS179 = Decimal.min(requestedElection, s179Out.totalSection179);
    const allowedS179 = Decimal.min(
      electedS179,
      s179Out.businessIncomeLimit,
      s179Out.allowedThisYear,
    );
    const cf = electedS179.minus(allowedS179);
    const basisAfter179 = cost.minus(electedS179);

    // Step 2 — Bonus on basis remaining after §179.
    const bonusOut = bonus168k.compute(
      {
        basisAfter179: basisAfter179.toNumber(),
        taxYear: input.taxYear,
        placedInServiceDate: input.placedInServiceDate,
        propertyClass: input.propertyClass,
        electOut: input.electOutOfBonus,
      },
      ctx,
    );
    const bonusDep = new Decimal(bonusOut.bonusDepreciation);
    const basisAfterBonus = basisAfter179.minus(bonusDep);

    // Step 3 — MACRS on basis remaining.
    const macrsInput =
      input.useAds && input.adsLifeYears !== undefined
        ? {
            basis: basisAfterBonus.toNumber(),
            propertyClass: input.propertyClass,
            placedInServiceYear: placedYear,
            placedInServiceMonth: placedMonth,
            useAds: true,
            adsLifeYears: input.adsLifeYears,
          }
        : {
            basis: basisAfterBonus.toNumber(),
            propertyClass: input.propertyClass,
            placedInServiceYear: placedYear,
            placedInServiceMonth: placedMonth,
            useAds: false,
          };
    const macrsOut = basisAfterBonus.gt(0)
      ? macrs.compute(macrsInput, ctx)
      : { method: "GDS-half-year" as const, schedule: [], totalDepreciation: 0 };

    const consolidated: Output["consolidatedSchedule"] = [];
    if (allowedS179.gt(0)) {
      consolidated.push({ year: placedYear, bucket: "section179", amount: allowedS179.toNumber() });
    }
    if (bonusDep.gt(0)) {
      consolidated.push({ year: placedYear, bucket: "bonus", amount: bonusDep.toNumber() });
    }
    for (const row of macrsOut.schedule) {
      consolidated.push({ year: row.year, bucket: "macrs", amount: row.depreciation });
    }

    const yearOne = allowedS179.plus(bonusDep).plus(macrsOut.schedule[0]?.depreciation ?? 0);
    const lifetime = consolidated.reduce((acc, row) => acc.plus(row.amount), new Decimal(0));

    return {
      electedSection179: electedS179.toNumber(),
      allowedSection179: allowedS179.toNumber(),
      section179Carryforward: cf.toNumber(),
      bonusDepreciation: bonusDep.toNumber(),
      bonusPctApplied: bonusOut.bonusPctApplied,
      basisAfter179AndBonus: basisAfterBonus.toNumber(),
      totalYearOneDeduction: yearOne.toNumber(),
      consolidatedSchedule: consolidated,
      totalLifetimeDeduction: lifetime.toNumber(),
    };
  },
  narrate(input, output) {
    return (
      `Depreciation waterfall on $${input.cost.toLocaleString("en-US")} class-${input.propertyClass} ` +
      `asset placed in service ${input.placedInServiceDate}: ` +
      `§179 $${output.allowedSection179.toLocaleString("en-US")}, ` +
      `bonus $${output.bonusDepreciation.toLocaleString("en-US")} ` +
      `(${(output.bonusPctApplied * 100).toFixed(0)}%), ` +
      `MACRS on $${output.basisAfter179AndBonus.toLocaleString("en-US")} remaining basis. ` +
      `Year-1 total: $${output.totalYearOneDeduction.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(waterfall);

export { waterfall };
