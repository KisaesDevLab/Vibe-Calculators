import type { z } from "zod";
import type { ResolvedTaxRow, TaxTableKind } from "@vibe-calc/db";

/**
 * Phase 15 — TaxCalculator<I,O> framework.
 *
 * Every tax calculator (Phases 16-19) implements this interface.
 * The shape lets us:
 *   - register calculators in one place (Phase 15.3 auto-generated
 *     REST endpoints, 15.4 auto-generated forms)
 *   - run each calculator's fixtures through a shared test runner
 *     (Phase 15.7)
 *   - keep the tax-year resolver hidden from compute() bodies — the
 *     dispatcher fetches the rate-table rows once and passes them
 *     pre-resolved
 */

export interface TaxCalculatorMetadata {
  /** Stable identifier — matches the calculations.kind enum value. */
  kind: string;
  /** Display label in the UI sidebar / picker. */
  name: string;
  /** One-paragraph description for the help drawer. */
  description: string;
  /** Tax years this calculator supports. */
  taxYears: number[];
  /** IRS forms / publications this calc maps to (for the PDF footer). */
  formReferences: string[];
  /**
   * Tax-table kinds the calculator's compute() needs. The dispatcher
   * resolves all of these via resolveTaxRows() before invoking
   * compute() so the body is pure.
   */
  requiredTables: TaxTableKind[];
}

export interface ValidationFailure {
  ok: false;
  issues: { path: string; message: string }[];
}

export interface ValidationSuccess<I> {
  ok: true;
  value: I;
}

export type ValidationResult<I> = ValidationSuccess<I> | ValidationFailure;

export interface ComputeContext {
  /** Pre-resolved tax-table rows keyed by kind. */
  tables: Map<TaxTableKind, ResolvedTaxRow>;
  /** The asOf date used for resolution; calculators that need other
   *  date-sensitive lookups can reuse this. */
  asOf: Date;
}

export interface TaxCalculator<I, O> {
  metadata: TaxCalculatorMetadata;
  /**
   * Zod schema for the inputs. Powers Phase 15.4 form generation.
   *
   * The third generic is `unknown` so calculators can use
   * `.default()` / `.optional()` — the parsed *output* type still
   * matches `I`, but the raw input is allowed to omit defaulted
   * fields.
   */
  inputSchema: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** Zod schema for the outputs (used by tests + Phase 15.5 result panel). */
  outputSchema: z.ZodType<O, z.ZodTypeDef, unknown>;
  /**
   * Validate raw user input. The default implementation runs
   * inputSchema.safeParse; calculators with cross-field rules (e.g.
   * 'phase-out start must be < phase-in end') override this.
   */
  validateInputs(raw: unknown): ValidationResult<I>;
  /**
   * Compute the result. Pure — no DB, no network. Must be deterministic
   * given the same (input, ctx).
   */
  compute(input: I, ctx: ComputeContext): O;
  /** Human-readable plain-English memo for the PDF / Phase 21 review. */
  narrate(input: I, output: O, ctx: ComputeContext): string;
}

export type AnyTaxCalculator = TaxCalculator<unknown, unknown>;
