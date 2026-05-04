import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 16.3 — Bonus depreciation under IRC §168(k).
 *
 * Pre-OBBBA phase-out:
 *   - 2022: 100%
 *   - 2023: 80%
 *   - 2024: 60%
 *   - 2025: 40%
 *   - 2026: 20%
 *   - 2027+: 0%
 *
 * OBBBA reinstatement (2025 H.R. enactment): 100% bonus for
 * property placed in service on or after 2025-01-20. The mid-year
 * cutover is encoded as a `tax_year_overrides` row with
 * effectiveFrom = 2025-01-20.
 *
 * The taxpayer may elect out by property class (a non-revocable
 * election made on Form 4562). The calc surfaces the elected
 * amount + remaining basis for downstream MACRS.
 */

const inputSchema = z
  .object({
    /** Cost basis after Section 179 reduction. */
    basisAfter179: z.number().nonnegative().finite(),
    /** Tax year. */
    taxYear: z.number().int().min(2022).max(2030),
    /** Date placed in service (UTC ISO yyyy-mm-dd). */
    placedInServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Property class (used by the election-out flag — not the math). */
    propertyClass: z.enum(["3", "5", "7", "10", "15", "20", "27.5", "39"]),
    /** Election out of bonus for this property class. */
    electOut: z.boolean().default(false),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  bonusPctApplied: z.number(),
  bonusDepreciation: z.number(),
  basisAfterBonus: z.number(),
  electedOut: z.boolean(),
  rateSource: z.string(),
});

type Output = z.infer<typeof outputSchema>;

interface BonusPayload {
  pct: number;
}

function isBonusPayload(v: unknown): v is BonusPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    "pct" in v &&
    typeof (v as { pct: unknown }).pct === "number"
  );
}

interface ResolvedRow {
  source: "table" | "override";
  row: { payload: unknown; effectiveFrom?: Date | string };
}

function readBonusPct(
  ctx: { tables: Map<TaxTableKind, unknown> },
  input: Input,
): { pct: number; rateSource: string } {
  const placedDate = new Date(`${input.placedInServiceDate}T00:00:00Z`);
  const row = ctx.tables.get("bonus_depreciation_pct") as ResolvedRow | null | undefined;
  if (row && isBonusPayload(row.row.payload)) {
    return {
      pct: row.row.payload.pct,
      rateSource: row.source === "override" ? "tax_year_overrides" : "tax_year_tables",
    };
  }
  // Fallback statutory schedule when no DB table is mounted.
  // Special-case OBBBA cutover for tests that exercise the rule
  // without spinning up Postgres.
  if (input.taxYear === 2025 && placedDate >= new Date("2025-01-20T00:00:00Z")) {
    return { pct: 1.0, rateSource: "statutory-fallback (OBBBA reinstatement)" };
  }
  const fallback: Record<number, number> = {
    2022: 1.0,
    2023: 0.8,
    2024: 0.6,
    2025: 0.4,
    2026: 0.2,
    2027: 0,
    2028: 0,
    2029: 0,
    2030: 0,
  };
  const pct = fallback[input.taxYear];
  if (pct === undefined) throw new Error(`No bonus pct for tax year ${input.taxYear}`);
  return { pct, rateSource: "statutory-fallback" };
}

const bonus168k: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.bonus_168k",
    name: "Bonus depreciation (§168(k))",
    description:
      "Computes bonus depreciation under IRC §168(k) by placed-in-service date, including the OBBBA 100% reinstatement for property placed in service on/after 2025-01-20.",
    taxYears: [2022, 2023, 2024, 2025, 2026, 2027],
    formReferences: ["Form 4562 Part II", "Pub 946 ch. 3"],
    requiredTables: ["bonus_depreciation_pct"],
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
    if (input.electOut) {
      return {
        bonusPctApplied: 0,
        bonusDepreciation: 0,
        basisAfterBonus: input.basisAfter179,
        electedOut: true,
        rateSource: "election-out",
      };
    }
    const { pct, rateSource } = readBonusPct(ctx, input);
    const basis = new Decimal(input.basisAfter179);
    const bonus = basis.times(pct).toDecimalPlaces(2);
    const remaining = basis.minus(bonus);
    return {
      bonusPctApplied: pct,
      bonusDepreciation: bonus.toNumber(),
      basisAfterBonus: remaining.toNumber(),
      electedOut: false,
      rateSource,
    };
  },
  narrate(input, output) {
    if (output.electedOut) {
      return `Taxpayer elected out of bonus depreciation for class ${input.propertyClass} property; full $${input.basisAfter179.toLocaleString("en-US")} basis flows to MACRS.`;
    }
    const pctDisplay = (output.bonusPctApplied * 100).toFixed(0);
    return (
      `${pctDisplay}% bonus depreciation on $${input.basisAfter179.toLocaleString("en-US")} basis ` +
      `(placed in service ${input.placedInServiceDate}): bonus = $${output.bonusDepreciation.toLocaleString("en-US")}, ` +
      `remaining basis to MACRS = $${output.basisAfterBonus.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(bonus168k);

export { bonus168k };
