import { expect, it } from "vitest";
import type { TaxCalculator, ComputeContext } from "./types.js";

/**
 * Phase 15.7 — shared fixture-driven test runner.
 *
 * Each calculator's *.fixtures.ts file exports an array of cases.
 * The runner verifies inputSchema.parse, runs compute(), and
 * compares against expected output. Every Phase 16-19 calculator
 * uses this so the fixture format + assertion semantics are
 * identical across the suite.
 */

export interface FixtureCase<I, O> {
  /** Stable id for the fixture (used as the test name). */
  name: string;
  /** Tax year the fixture is asserted against. */
  taxYear: number;
  input: I;
  /** Subset-equality: every key in `expectedOutput` must match the
   *  computed output. The output may carry additional fields. */
  expectedOutput: Partial<O>;
  /** Source citation — IRS Pub / form / Rev. Proc. — for audit. */
  source: string;
  /** Optional ComputeContext override — if omitted, runner builds
   *  an empty `tables` map. */
  context?: Partial<ComputeContext>;
  /** Tolerance per numeric field, in dollars. Default $1 per build
   *  plan correctness benchmark. */
  toleranceDollars?: number;
}

const DEFAULT_TOLERANCE = 1;

function isNumericLike(v: unknown): v is { toNumber(): number } {
  return (
    typeof v === "object" &&
    v !== null &&
    "toNumber" in v &&
    typeof (v as { toNumber: unknown }).toNumber === "function"
  );
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return v;
  // eslint-disable-next-line no-restricted-syntax -- Test-assertion comparison path: tolerance comparisons are inherently scalar; no TVM math runs here.
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (isNumericLike(v)) return v.toNumber();
  return null;
}

/**
 * Run every fixture for a calculator. Call inside `describe(...)`.
 */
export function runFixtures<I, O>(calc: TaxCalculator<I, O>, cases: FixtureCase<I, O>[]): void {
  for (const c of cases) {
    it(`${calc.metadata.kind}: ${c.name}`, () => {
      const validated = calc.validateInputs(c.input);
      if (!validated.ok) {
        throw new Error(
          `Fixture '${c.name}' failed input validation: ${validated.issues
            .map((i) => `${i.path}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const ctx: ComputeContext = {
        tables: c.context?.tables ?? new Map(),
        asOf: c.context?.asOf ?? new Date(Date.UTC(c.taxYear, 5, 30)),
      };
      const out = calc.compute(validated.value, ctx);

      for (const key of Object.keys(c.expectedOutput) as (keyof O)[]) {
        const expected = c.expectedOutput[key];
        const actual = (out as Record<string, unknown>)[key as string];
        const eNum = toNum(expected);
        const aNum = toNum(actual);
        if (eNum !== null && aNum !== null) {
          const tol = c.toleranceDollars ?? DEFAULT_TOLERANCE;
          expect(
            Math.abs(aNum - eNum),
            `${String(key)}: expected ${eNum}±${tol}, got ${aNum} (source: ${c.source})`,
          ).toBeLessThanOrEqual(tol);
        } else {
          expect(actual, `${String(key)} (source: ${c.source})`).toEqual(expected);
        }
      }
    });
  }
}
