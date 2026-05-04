import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 19.7 — Qualified plan contribution-limit calculator.
 *
 * Plans covered:
 *   - 401(k) / 403(b) / 457(b)
 *   - SEP IRA
 *   - SIMPLE IRA
 *   - Solo 401(k) (employee + employer combined)
 *   - Defined-benefit annual maximum
 *
 * IRC §415(c) overall annual addition limit:
 *   2024: $69,000 / 2025: $70,000
 *
 * 2024 employee deferral limit: $23,000; catch-up $7,500 (age 50+).
 * 2025 employee deferral limit: $23,500; catch-up $7,500.
 * SECURE 2.0 §109 enhanced catch-up (ages 60-63): $11,250 in 2025.
 */

const inputSchema = z
  .object({
    planType: z.enum([
      "401k",
      "403b",
      "457b",
      "sep_ira",
      "simple_ira",
      "solo_401k",
      "defined_benefit",
    ]),
    /** Age at year-end. */
    age: z.number().int().min(18).max(120),
    /** Eligible compensation (W-2 or net SE earnings). */
    compensation: z.number().nonnegative().finite(),
    /** Employee elective deferral planned. */
    employeeDeferralPlanned: z.number().nonnegative().finite().default(0),
    /** Employer match / profit-sharing planned. */
    employerContributionPlanned: z.number().nonnegative().finite().default(0),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  employeeLimit: z.number(),
  employerLimit: z.number(),
  combinedLimit: z.number(),
  catchupApplied: z.number(),
  totalAllowed: z.number(),
  excess: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

interface RetirementPayload {
  ["401k"]: number;
  ["401kCatchup50"]: number;
  ["401kCatchup60to63"]?: number;
  ira: number;
  iraCatchup50: number;
  sepIra: { pct: number; dollarCap: number };
  simpleIra: number;
  simpleIraCatchup50: number;
  defBenAnnualMax: number;
  ["415cLimit"]?: number;
}

const FALLBACK: Record<number, RetirementPayload> = {
  2024: {
    "401k": 23_000,
    "401kCatchup50": 7_500,
    ira: 7_000,
    iraCatchup50: 1_000,
    sepIra: { pct: 0.25, dollarCap: 69_000 },
    simpleIra: 16_000,
    simpleIraCatchup50: 3_500,
    defBenAnnualMax: 275_000,
    "415cLimit": 69_000,
  },
  2025: {
    "401k": 23_500,
    "401kCatchup50": 7_500,
    "401kCatchup60to63": 11_250,
    ira: 7_000,
    iraCatchup50: 1_000,
    sepIra: { pct: 0.25, dollarCap: 70_000 },
    simpleIra: 16_500,
    simpleIraCatchup50: 3_500,
    defBenAnnualMax: 280_000,
    "415cLimit": 70_000,
  },
};

interface ResolvedTableRow {
  source: "table" | "override";
  row: { payload: unknown };
}

function readRetirement(
  ctx: { tables: Map<TaxTableKind, unknown> },
  taxYear: number,
): RetirementPayload {
  const row = ctx.tables.get("retirement_contribution_limits") as
    | ResolvedTableRow
    | null
    | undefined;
  if (
    row &&
    typeof row.row.payload === "object" &&
    row.row.payload !== null &&
    "401k" in row.row.payload
  ) {
    return row.row.payload as unknown as RetirementPayload;
  }
  const fallback = FALLBACK[taxYear];
  if (!fallback) throw new Error(`No retirement limits for ${taxYear}`);
  return fallback;
}

const qualifiedPlanLimits: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.qualified_plan_limits",
    name: "Qualified-plan contribution limits",
    description:
      "401(k)/403(b)/457(b) employee + employer §415(c) limits, SEP IRA (lesser of 25% or annual cap), SIMPLE IRA, Solo 401(k), defined benefit. Per IRC §415 and SECURE 2.0.",
    taxYears: [2024, 2025],
    formReferences: ["IRC §415", "SECURE 2.0 §§107/109", "Pub 560"],
    requiredTables: ["retirement_contribution_limits"],
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
    const limits = readRetirement(ctx, input.taxYear);
    const fourFifteenC = limits["415cLimit"] ?? FALLBACK[input.taxYear]?.["415cLimit"] ?? 69_000;
    const notes: string[] = [];

    let employeeLimit = 0;
    let employerLimit = 0;
    let combinedLimit = 0;
    let catchup = 0;

    if (input.planType === "401k" || input.planType === "403b" || input.planType === "457b") {
      employeeLimit = limits["401k"];
      // Catch-up: regular 50+, enhanced 60-63 in 2025.
      if (input.age >= 60 && input.age <= 63 && limits["401kCatchup60to63"] !== undefined) {
        catchup = limits["401kCatchup60to63"];
      } else if (input.age >= 50) {
        catchup = limits["401kCatchup50"];
      }
      employerLimit = Math.max(0, fourFifteenC - employeeLimit - catchup);
      combinedLimit = fourFifteenC + catchup;
    } else if (input.planType === "sep_ira") {
      const sep = limits.sepIra;
      const pctLimit = new Decimal(input.compensation).times(sep.pct).toNumber();
      employerLimit = Math.min(pctLimit, sep.dollarCap);
      combinedLimit = employerLimit;
    } else if (input.planType === "simple_ira") {
      employeeLimit = limits.simpleIra;
      catchup = input.age >= 50 ? limits.simpleIraCatchup50 : 0;
      // SIMPLE employer match: 3% of comp (or 2% nonelective).
      employerLimit = new Decimal(input.compensation).times(0.03).toNumber();
      combinedLimit = employeeLimit + catchup + employerLimit;
    } else if (input.planType === "solo_401k") {
      employeeLimit = limits["401k"];
      catchup = input.age >= 50 ? limits["401kCatchup50"] : 0;
      // Solo 401(k) employer = up to 25% of net SE earnings (or 20% as netted).
      const employerSep = new Decimal(input.compensation).times(0.25).toNumber();
      employerLimit = employerSep;
      combinedLimit = Math.min(fourFifteenC + catchup, employeeLimit + catchup + employerLimit);
    } else {
      // Defined benefit
      combinedLimit = limits.defBenAnnualMax;
      employerLimit = combinedLimit;
      notes.push(
        "Defined benefit max is actuarially determined; calc shows the §415(b) annual benefit cap, not the funding contribution.",
      );
    }

    const total = new Decimal(input.employeeDeferralPlanned).plus(
      input.employerContributionPlanned,
    );
    const allowed = Decimal.min(total, combinedLimit);
    const excess = Decimal.max(0, total.minus(combinedLimit));

    if (
      input.age >= 60 &&
      input.age <= 63 &&
      input.planType.includes("401k") &&
      limits["401kCatchup60to63"]
    ) {
      notes.push(
        `SECURE 2.0 §109 enhanced catch-up applies (ages 60-63): $${catchup.toLocaleString("en-US")} for ${input.taxYear}.`,
      );
    }

    return {
      employeeLimit,
      employerLimit,
      combinedLimit,
      catchupApplied: catchup,
      totalAllowed: allowed.toDecimalPlaces(2).toNumber(),
      excess: excess.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `${input.planType} contribution limits for ${input.taxYear}: ` +
      `employee $${output.employeeLimit.toLocaleString("en-US")} ` +
      `(catch-up $${output.catchupApplied.toLocaleString("en-US")}), ` +
      `combined cap $${output.combinedLimit.toLocaleString("en-US")}. ` +
      `Allowed: $${output.totalAllowed.toLocaleString("en-US")}, excess $${output.excess.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(qualifiedPlanLimits);

export { qualifiedPlanLimits };
