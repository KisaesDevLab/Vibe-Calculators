import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 16.2 — Section 179 expensing.
 *
 * IRC §179: a taxpayer may elect to deduct the cost of qualifying
 * property placed in service during the year, up to a dollar
 * limit. Once total qualifying property exceeds a phase-out
 * threshold, the dollar limit reduces $1 for every $1 over.
 *
 *   Allowable §179 = max(0, limit - max(0, totalCost - phaseoutStart))
 *
 * Then capped by:
 *   - SUV cap on heavy-SUV-class purchases ($28,900 in 2024 / $31,300 in 2025)
 *   - Business-income limitation (cannot exceed taxpayer's aggregate
 *     business income from active trades/businesses) — excess
 *     carries forward to next year
 *   - MFS allocation: married-filing-separately spouses split the
 *     limit evenly unless they consent to a different allocation
 *
 * Limits are sourced from `section_179_limits` rate table.
 */

const inputSchema = z
  .object({
    /** Total cost of all §179-eligible property placed in service. */
    totalQualifyingCost: z.number().nonnegative().finite(),
    /** Cost of heavy SUVs (subject to separate SUV cap). */
    heavySuvCost: z.number().nonnegative().finite().default(0),
    /** Aggregate business income from all active trades/businesses. */
    aggregateBusinessIncome: z.number().finite(),
    /** Filing status — drives MFS allocation. */
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("mfj"),
    /** MFS allocation percentage to this taxpayer (0..1). Default 0.5. */
    mfsAllocation: z.number().min(0).max(1).default(0.5),
    /** Tax year — drives limit lookup. */
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  statutoryLimit: z.number(),
  effectiveLimitAfterPhaseout: z.number(),
  effectiveLimitAfterMfs: z.number(),
  suvCap: z.number(),
  suvSection179: z.number(),
  nonSuvSection179: z.number(),
  totalSection179: z.number(),
  businessIncomeLimit: z.number(),
  allowedThisYear: z.number(),
  carryforward: z.number(),
});

type Output = z.infer<typeof outputSchema>;

interface Section179Limits {
  limit: number;
  phaseoutStart: number;
  suvCap: number;
}

function readLimits(
  ctx: { tables: Map<TaxTableKind, unknown> },
  taxYear: number,
): Section179Limits {
  const row = ctx.tables.get("section_179_limits");
  if (
    row &&
    typeof row === "object" &&
    "row" in row &&
    row.row &&
    typeof (row as { row: { payload?: unknown } }).row.payload === "object"
  ) {
    const payload = (row as { row: { payload: Record<string, unknown> } }).row.payload;
    if (
      typeof payload.limit === "number" &&
      typeof payload.phaseoutStart === "number" &&
      typeof payload.suvCap === "number"
    ) {
      return {
        limit: payload.limit,
        phaseoutStart: payload.phaseoutStart,
        suvCap: payload.suvCap,
      };
    }
  }
  // Fallback constants — kept in sync with seed-tax-tables for
  // unit tests that don't mount the DB. Phase 14 seed is
  // authoritative when a DB is present.
  if (taxYear === 2024) return { limit: 1_160_000, phaseoutStart: 2_890_000, suvCap: 28_900 };
  if (taxYear === 2025) return { limit: 1_250_000, phaseoutStart: 3_130_000, suvCap: 31_300 };
  throw new Error(`No section_179_limits table for tax year ${taxYear}`);
}

const section179: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.section_179",
    name: "Section 179 expensing",
    description:
      "Computes allowed Section 179 deduction with phase-out, SUV cap, business-income limit, MFS allocation, and carryforward. Per IRC §179 and Pub 946.",
    taxYears: [2024, 2025],
    formReferences: ["Form 4562 Part I", "Pub 946"],
    requiredTables: ["section_179_limits"],
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
    const limits = readLimits(ctx, input.taxYear);
    const total = new Decimal(input.totalQualifyingCost);
    const phaseoutStart = new Decimal(limits.phaseoutStart);
    const phaseout = Decimal.max(0, total.minus(phaseoutStart));
    const effectiveLimit = Decimal.max(0, new Decimal(limits.limit).minus(phaseout));
    const mfsLimit =
      input.filingStatus === "mfs" ? effectiveLimit.times(input.mfsAllocation) : effectiveLimit;

    // SUV cap applies inside the §179 election: SUV-class assets
    // claim against the SUV cap; remaining limit is available for
    // non-SUV property.
    const suvCost = new Decimal(input.heavySuvCost);
    const suvElected = Decimal.min(suvCost, limits.suvCap, mfsLimit);
    const remainingLimitAfterSuv = mfsLimit.minus(suvElected);

    const nonSuvCost = total.minus(suvCost);
    const nonSuvElected = Decimal.max(0, Decimal.min(nonSuvCost, remainingLimitAfterSuv));

    const totalElected = suvElected.plus(nonSuvElected);

    const businessIncomeLimit = new Decimal(input.aggregateBusinessIncome);
    const allowed = Decimal.max(0, Decimal.min(totalElected, businessIncomeLimit));
    const carryforward = totalElected.minus(allowed);

    return {
      statutoryLimit: limits.limit,
      effectiveLimitAfterPhaseout: effectiveLimit.toNumber(),
      effectiveLimitAfterMfs: mfsLimit.toNumber(),
      suvCap: limits.suvCap,
      suvSection179: suvElected.toNumber(),
      nonSuvSection179: nonSuvElected.toNumber(),
      totalSection179: totalElected.toNumber(),
      businessIncomeLimit: businessIncomeLimit.toNumber(),
      allowedThisYear: allowed.toNumber(),
      carryforward: carryforward.toNumber(),
    };
  },
  narrate(input, output) {
    const limit = output.effectiveLimitAfterMfs;
    const allowed = output.allowedThisYear;
    const cf = output.carryforward;
    const cfClause = cf > 0 ? ` Carryforward to next year: $${cf.toLocaleString("en-US")}.` : "";
    return (
      `On $${input.totalQualifyingCost.toLocaleString("en-US")} of §179 property in ${input.taxYear}, ` +
      `the effective limit (after phase-out${input.filingStatus === "mfs" ? " and MFS split" : ""}) is ` +
      `$${limit.toLocaleString("en-US")}. Allowed this year: $${allowed.toLocaleString("en-US")}.${cfClause}`
    );
  },
};

registerCalculator(section179);

export { section179 };
