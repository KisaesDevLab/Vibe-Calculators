import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 18.1 — Federal estimated-tax safe-harbor calculator.
 *
 * IRC §6654 — to avoid the underpayment penalty, the taxpayer must
 * pay through withholding + estimated taxes the LESSER of:
 *
 *   (a) 90% of current-year tax, OR
 *   (b) 100% of prior-year tax (110% if prior-year AGI > $150,000;
 *       $75,000 if MFS)
 *
 * Quarterly due dates:
 *   Q1: April 15
 *   Q2: June 15
 *   Q3: September 15
 *   Q4: January 15 of the following year
 *
 * If a due date falls on a weekend or federal holiday, it shifts to
 * the next business day. Calc uses the statutory date — banking-day
 * adjustment is a Phase 18 follow-up.
 */

const inputSchema = z
  .object({
    /** Estimated current-year total tax (after credits, before withholding/payments). */
    currentYearProjectedTax: z.number().nonnegative().finite(),
    /** Prior-year total tax (Form 1040 line 24 - certain credits). */
    priorYearTax: z.number().nonnegative().finite(),
    /** Prior-year AGI (drives the 100/110% threshold). */
    priorYearAgi: z.number().nonnegative().finite(),
    /** Withholding YTD + projected for the rest of year. */
    withholdingTotal: z.number().nonnegative().finite().default(0),
    filingStatus: z.enum(["single", "mfj", "mfs", "hoh", "qss"]).default("single"),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const quarterlySchema = z.object({
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  dueDate: z.string(),
  amount: z.number(),
});

const outputSchema = z.object({
  ninetyPctRule: z.number(),
  hundredOrTenPctRule: z.number(),
  hundredTenApplies: z.boolean(),
  requiredAnnualPayment: z.number(),
  remainingAfterWithholding: z.number(),
  perQuarterAmount: z.number(),
  quarterly: z.array(quarterlySchema),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

function quarterlyDueDates(taxYear: number): { Q1: string; Q2: string; Q3: string; Q4: string } {
  return {
    Q1: `${taxYear}-04-15`,
    Q2: `${taxYear}-06-15`,
    Q3: `${taxYear}-09-15`,
    Q4: `${taxYear + 1}-01-15`,
  };
}

const safeHarbor: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.safe_harbor",
    name: "Federal estimated-tax safe harbor",
    description:
      "Computes the required annual payment under the 90% / 100% / 110% rules and produces a quarterly schedule. Per IRC §6654.",
    taxYears: [2024, 2025, 2026],
    formReferences: ["Form 1040-ES", "Form 2210"],
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
    const ninetyPct = new Decimal(input.currentYearProjectedTax).times(0.9);
    // 110% rule kicks in for AGI > $150,000 ($75,000 if MFS).
    const agiThreshold = input.filingStatus === "mfs" ? 75_000 : 150_000;
    const hundredTenApplies = input.priorYearAgi > agiThreshold;
    const priorPctMultiplier = hundredTenApplies ? 1.1 : 1.0;
    const priorYearRule = new Decimal(input.priorYearTax).times(priorPctMultiplier);

    const required = Decimal.min(ninetyPct, priorYearRule);
    const remaining = Decimal.max(0, required.minus(input.withholdingTotal));
    const perQuarter = remaining.div(4).toDecimalPlaces(2);

    const due = quarterlyDueDates(input.taxYear);
    const quarterly: Output["quarterly"] = [
      { quarter: "Q1", dueDate: due.Q1, amount: perQuarter.toNumber() },
      { quarter: "Q2", dueDate: due.Q2, amount: perQuarter.toNumber() },
      { quarter: "Q3", dueDate: due.Q3, amount: perQuarter.toNumber() },
      { quarter: "Q4", dueDate: due.Q4, amount: perQuarter.toNumber() },
    ];
    // Pin Q4 to absorb rounding so the four installments sum to remaining.
    const sumOfFirstThree = perQuarter.times(3);
    const lastQuarter = remaining.minus(sumOfFirstThree).toDecimalPlaces(2);
    if (quarterly[3]) quarterly[3].amount = lastQuarter.toNumber();

    const notes: string[] = [];
    if (hundredTenApplies) {
      notes.push(
        `Prior-year AGI $${input.priorYearAgi.toLocaleString("en-US")} exceeds the $${agiThreshold.toLocaleString("en-US")} threshold — the 110% rule applies (vs. 100%).`,
      );
    }
    if (ninetyPct.lt(priorYearRule)) {
      notes.push(
        "90% of projected current-year tax is the binding rule (lower than the prior-year rule).",
      );
    } else {
      notes.push(
        `${hundredTenApplies ? "110%" : "100%"} of prior-year tax is the binding rule — pay this amount to lock in safe harbor regardless of how the current year actually shakes out.`,
      );
    }
    if (input.withholdingTotal >= required.toNumber()) {
      notes.push(
        "Withholding alone covers the safe-harbor requirement; no estimated payments needed.",
      );
    }

    return {
      ninetyPctRule: ninetyPct.toDecimalPlaces(2).toNumber(),
      hundredOrTenPctRule: priorYearRule.toDecimalPlaces(2).toNumber(),
      hundredTenApplies,
      requiredAnnualPayment: required.toDecimalPlaces(2).toNumber(),
      remainingAfterWithholding: remaining.toDecimalPlaces(2).toNumber(),
      perQuarterAmount: perQuarter.toNumber(),
      quarterly,
      notes,
    };
  },
  narrate(input, output) {
    return (
      `Safe harbor for ${input.taxYear}: pay $${output.requiredAnnualPayment.toLocaleString("en-US")} ` +
      `total (lesser of 90% of projected ${output.ninetyPctRule.toLocaleString("en-US")} or ${output.hundredTenApplies ? "110%" : "100%"} of prior-year ${output.hundredOrTenPctRule.toLocaleString("en-US")}). ` +
      `After $${input.withholdingTotal.toLocaleString("en-US")} of withholding, $${output.perQuarterAmount.toLocaleString("en-US")}/quarter through Form 1040-ES.`
    );
  },
};

registerCalculator(safeHarbor);

export { safeHarbor };
