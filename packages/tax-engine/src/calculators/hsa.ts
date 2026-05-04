import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 19.6 — HSA contribution + projection.
 *
 * Limits (Rev. Proc. 2023-23 / 2024-25):
 *   - Self-only: $4,150 (2024), $4,300 (2025)
 *   - Family: $8,300 (2024), $8,550 (2025)
 *   - Age-55 catch-up: +$1,000 (statutory, both years)
 *
 * Last-month rule: a person who is HSA-eligible on Dec 1 may
 * contribute the full year's limit, but must remain eligible
 * through the testing period (Dec 1 next year). If they fail the
 * testing period, the excess is income + 10% penalty.
 */

const inputSchema = z
  .object({
    coverage: z.enum(["self_only", "family"]),
    /** Age at year-end. */
    age: z.number().int().min(0).max(120),
    /** Months HSA-eligible during the year. */
    monthsEligible: z.number().int().min(0).max(12),
    /** Currently planned contribution. */
    plannedContribution: z.number().nonnegative().finite().default(0),
    /** Use last-month rule? */
    useLastMonthRule: z.boolean().default(false),
    taxYear: z.number().int().min(2024).max(2026),
    /** Projection inputs. */
    currentBalance: z.number().nonnegative().finite().default(0),
    yearsToProject: z.number().int().min(0).max(50).default(20),
    growthRate: z.number().min(0).max(1).default(0.06),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  baseLimit: z.number(),
  catchupAllowed: z.number(),
  proRatedLimit: z.number(),
  finalLimit: z.number(),
  contributionRoom: z.number(),
  excessContribution: z.number(),
  projectedBalance: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

interface HsaPayload {
  selfOnly: number;
  family: number;
  catchup55: number;
}

const HSA_FALLBACK: Record<number, HsaPayload> = {
  2024: { selfOnly: 4_150, family: 8_300, catchup55: 1_000 },
  2025: { selfOnly: 4_300, family: 8_550, catchup55: 1_000 },
};

interface ResolvedTableRow {
  source: "table" | "override";
  row: { payload: unknown };
}

function readHsa(ctx: { tables: Map<TaxTableKind, unknown> }, taxYear: number): HsaPayload {
  const row = ctx.tables.get("hsa_contribution_limits") as ResolvedTableRow | null | undefined;
  if (
    row &&
    typeof row.row.payload === "object" &&
    row.row.payload !== null &&
    "selfOnly" in row.row.payload
  ) {
    return row.row.payload as unknown as HsaPayload;
  }
  const fallback = HSA_FALLBACK[taxYear];
  if (!fallback) throw new Error(`No HSA limits for ${taxYear}`);
  return fallback;
}

const hsa: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.hsa",
    name: "HSA contribution & projection",
    description:
      "HSA limit (self-only / family) with age-55 catch-up, monthly proration, last-month rule, and triple-tax-advantage projection. Per IRC §223 and Rev. Proc. 2023-23 / 2024-25.",
    taxYears: [2024, 2025],
    formReferences: ["Form 8889", "Pub 969"],
    requiredTables: ["hsa_contribution_limits"],
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
    const limits = readHsa(ctx, input.taxYear);
    const baseLimit = input.coverage === "family" ? limits.family : limits.selfOnly;
    const catchup = input.age >= 55 ? limits.catchup55 : 0;

    let proRated: Decimal;
    if (input.useLastMonthRule && input.monthsEligible >= 1) {
      proRated = new Decimal(baseLimit + catchup);
    } else {
      proRated = new Decimal(baseLimit + catchup).times(input.monthsEligible).div(12);
    }

    const finalLimit = proRated.toDecimalPlaces(2);
    const room = Decimal.max(0, finalLimit.minus(input.plannedContribution));
    const excess = Decimal.max(0, new Decimal(input.plannedContribution).minus(finalLimit));

    // Projection: future value of (currentBalance + plannedContribution) compounded annually
    // assuming the contribution lands at year start.
    const r = new Decimal(1).plus(input.growthRate);
    const fv = new Decimal(input.currentBalance)
      .plus(input.plannedContribution)
      .times(r.pow(input.yearsToProject));

    const notes: string[] = [];
    if (input.useLastMonthRule) {
      notes.push(
        "Last-month rule applied: full annual limit available, but must remain HSA-eligible through Dec 1 of next year (testing period). Failure → excess is income + 10% penalty.",
      );
    }
    if (excess.gt(0)) {
      notes.push(
        `Excess contribution $${excess.toString()} — withdraw before tax-filing deadline + extensions to avoid 6% excise tax.`,
      );
    }
    if (input.age >= 55) {
      notes.push(`Age-55 catch-up of $${catchup} included.`);
    }

    return {
      baseLimit,
      catchupAllowed: catchup,
      proRatedLimit: proRated.toDecimalPlaces(2).toNumber(),
      finalLimit: finalLimit.toNumber(),
      contributionRoom: room.toDecimalPlaces(2).toNumber(),
      excessContribution: excess.toDecimalPlaces(2).toNumber(),
      projectedBalance: fv.toDecimalPlaces(2).toNumber(),
      notes,
    };
  },
  narrate(input, output) {
    return (
      `HSA ${input.coverage} for ${input.taxYear}: limit $${output.finalLimit.toLocaleString("en-US")} ` +
      `(${input.monthsEligible}/12 months${input.useLastMonthRule ? " under last-month rule" : ""}), ` +
      `room $${output.contributionRoom.toLocaleString("en-US")}. ` +
      `Projected balance after ${input.yearsToProject} years @ ${(input.growthRate * 100).toFixed(1)}%: ` +
      `$${output.projectedBalance.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(hsa);

export { hsa };
