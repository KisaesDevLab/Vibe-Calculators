/**
 * @vibe-calc/calc-engine — pure, side-effect-free TVM math primitives.
 *
 * Per CLAUDE.md "Math: Never `Number` for money or rates" — this
 * package has zero runtime dependencies on the app code; it only
 * imports decimal.js (precision) and date-fns (calendar arithmetic).
 *
 * Phase 5 establishes:
 *   - Money / Rate branded types (types.ts)
 *   - Currency rounding modes (rounding.ts)
 *   - 6 day-count conventions + year fractions (day-count.ts)
 *   - 12 compounding intervals + period-length math (compounding.ts)
 *   - Nominal ↔ effective rate conversions (period-rate.ts)
 *   - Date arithmetic for every period type (date-arithmetic.ts)
 *
 * Phase 6 adds the TVM solver; Phase 7 the cash-flow engine. Both
 * import from this package.
 */

export const CALC_ENGINE_PACKAGE = "@vibe-calc/calc-engine" as const;

export * from "./types.js";
export * from "./rounding.js";
export * from "./day-count.js";
export * from "./compounding.js";
export * from "./period-rate.js";
export * from "./date-arithmetic.js";
export * from "./tvm-solver.js";
export * from "./cashflow-events.js";
export * from "./cashflow-schedule.js";
export * from "./cashflow-extensions.js";
export * from "./reg-z.js";
