import type { AnyTaxCalculator, TaxCalculator } from "./types.js";

/**
 * Phase 15.3 — calculator registry.
 *
 * Each calculator self-registers via registerCalculator() at module
 * load. The dispatcher (Phase 15.3 auto-generated REST endpoints in
 * apps/api) iterates this map to surface routes; the workbench /
 * picker UI iterates it to surface menu entries.
 */

const REGISTRY = new Map<string, AnyTaxCalculator>();

export function registerCalculator<I, O>(calc: TaxCalculator<I, O>): void {
  if (REGISTRY.has(calc.metadata.kind)) {
    throw new Error(
      `Tax calculator '${calc.metadata.kind}' is already registered. Each kind must be unique.`,
    );
  }
  REGISTRY.set(calc.metadata.kind, calc as AnyTaxCalculator);
}

export function getCalculator(kind: string): AnyTaxCalculator | undefined {
  return REGISTRY.get(kind);
}

export function listCalculators(): readonly AnyTaxCalculator[] {
  return [...REGISTRY.values()];
}

/** Test-only — clears the registry between test files. */
export function _resetRegistryForTests(): void {
  REGISTRY.clear();
}
