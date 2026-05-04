import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import { applyBrackets, type BracketRow } from "../lib/bracket-tax.js";
import { STATE_SCHEDULES_2025 } from "../lib/state-brackets.js";

/**
 * Phase 18.3 — state income-tax quick-estimator.
 *
 * Approximate output. Calc is a planning tool, not a substitute for
 * state-form prep. Each state's exact rules (state-specific
 * deductions, credits, addbacks, retirement-income exclusions, etc.)
 * are not modeled — only the headline bracket schedule.
 */

const STATE_CODES = ["MO", "CA", "NY", "IL", "PA", "OH", "GA", "NC", "AZ", "FL", "TX"] as const;

const inputSchema = z
  .object({
    state: z.enum(STATE_CODES),
    /** Federal AGI — most states use this as the starting point for state taxable income. */
    federalAgi: z.number().nonnegative().finite(),
    /** Number of personal exemptions (used by states that still have them — MO, others ignore). */
    personalExemptions: z.number().int().min(0).max(20).default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    /** State-specific deductions/credits the user wants subtracted before brackets. */
    additionalSubtractions: z.number().nonnegative().finite().default(0),
    taxYear: z.number().int().min(2025).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  state: z.string(),
  hasIncomeTax: z.boolean(),
  standardDeductionApplied: z.number(),
  stateTaxableIncome: z.number(),
  stateIncomeTax: z.number(),
  effectiveStateRate: z.number(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const stateTax: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.state_estimator",
    name: "State income-tax quick estimator",
    description:
      "Approximate state income tax using the published 2025 bracket schedule and standard deduction. Not a substitute for state-form prep — state-specific deductions, credits, and addbacks are not modeled.",
    taxYears: [2025, 2026],
    formReferences: ["state-specific resident return"],
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
    const sched = STATE_SCHEDULES_2025[input.state];
    if (!sched) {
      throw new Error(`Unknown state: ${input.state}`);
    }
    const notes: string[] = [
      "Approximation only — does not include state-specific credits, deductions, or retirement-income exclusions. Not a substitute for state-form prep.",
    ];

    if (!sched.hasIncomeTax) {
      notes.push(`${sched.state} does not impose a state income tax.`);
      return {
        state: sched.state,
        hasIncomeTax: false,
        standardDeductionApplied: 0,
        stateTaxableIncome: 0,
        stateIncomeTax: 0,
        effectiveStateRate: 0,
        notes,
      };
    }

    const stdSingle = sched.standardDeductionSingle ?? 0;
    const std =
      input.filingStatus === "mfj" || input.filingStatus === "qss" ? stdSingle * 2 : stdSingle;
    const taxable = Decimal.max(
      0,
      new Decimal(input.federalAgi).minus(std).minus(input.additionalSubtractions),
    );

    const brackets: BracketRow[] = (sched.brackets ?? []).map((b) => ({
      rate: b.rate,
      upto: b.upto,
    }));
    const tax = applyBrackets(taxable.toNumber(), brackets);
    const effectiveRate = taxable.gt(0)
      ? new Decimal(tax).div(taxable).toDecimalPlaces(4).toNumber()
      : 0;

    return {
      state: sched.state,
      hasIncomeTax: true,
      standardDeductionApplied: std,
      stateTaxableIncome: taxable.toNumber(),
      stateIncomeTax: new Decimal(tax).toDecimalPlaces(2).toNumber(),
      effectiveStateRate: effectiveRate,
      notes,
    };
  },
  narrate(input, output) {
    if (!output.hasIncomeTax) {
      return `${output.state} has no state income tax.`;
    }
    return (
      `${output.state} ${input.taxYear} estimated tax on $${input.federalAgi.toLocaleString("en-US")} federal AGI: ` +
      `$${output.stateIncomeTax.toLocaleString("en-US")} (effective rate ${(output.effectiveStateRate * 100).toFixed(2)}%). ` +
      `${output.notes[0] ?? ""}`
    );
  },
};

registerCalculator(stateTax);

export { stateTax };
