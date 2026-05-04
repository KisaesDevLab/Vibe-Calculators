import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 18.4 — annualization helpers.
 *
 * Given YTD wages or YTD SE earnings + an as-of date, project the
 * full-year amount. Used as a feeder for SE tax planning and
 * safe-harbor calcs.
 *
 * Cadence-aware: weekly / biweekly / semimonthly / monthly. The
 * "remaining periods" formula handles each cadence's expected
 * number of paydates.
 */

const inputSchema = z
  .object({
    ytdAmount: z.number().finite(),
    /** YYYY-MM-DD of the most recent pay period covered by ytdAmount. */
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cadence: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
    taxYear: z.number().int().min(2024).max(2026),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  periodsCompleted: z.number(),
  periodsRemaining: z.number(),
  perPeriodAverage: z.number(),
  projectedFullYear: z.number(),
  asOfDayOfYear: z.number(),
});

type Output = z.infer<typeof outputSchema>;

function periodsPerYear(cadence: Input["cadence"]): number {
  switch (cadence) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    case "monthly":
      return 12;
  }
}

function dayOfYear(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const ms = d.getTime() - yearStart.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

const annualization: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.annualization",
    name: "YTD annualization",
    description:
      "Projects full-year wages or SE earnings from a YTD figure + as-of date. Cadence-aware (weekly / biweekly / semimonthly / monthly).",
    taxYears: [2024, 2025, 2026],
    formReferences: ["Form 1040-ES Part I", "Pub 505 ch. 2"],
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
    const periods = periodsPerYear(input.cadence);
    const doy = dayOfYear(input.asOfDate);
    const yearLength = 365; // ignoring leap-year sub-day for advisory purposes
    const ratio = doy / yearLength;
    const periodsCompleted = Math.max(1, Math.round(periods * ratio));
    const periodsRemaining = Math.max(0, periods - periodsCompleted);
    const perPeriod =
      periodsCompleted > 0 ? new Decimal(input.ytdAmount).div(periodsCompleted) : new Decimal(0);
    const projected = perPeriod.times(periods).toDecimalPlaces(2);

    return {
      periodsCompleted,
      periodsRemaining,
      perPeriodAverage: perPeriod.toDecimalPlaces(2).toNumber(),
      projectedFullYear: projected.toNumber(),
      asOfDayOfYear: doy,
    };
  },
  narrate(input, output) {
    return (
      `As of ${input.asOfDate} (day ${output.asOfDayOfYear} of year), $${input.ytdAmount.toLocaleString("en-US")} ` +
      `YTD over ${output.periodsCompleted} ${input.cadence} periods averages ` +
      `$${output.perPeriodAverage.toLocaleString("en-US")}/period → projected full-year ` +
      `$${output.projectedFullYear.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(annualization);

export { annualization };
