import Decimal from "decimal.js";
import { money, type Money } from "./types.js";

/**
 * Phase 5.2 — currency rounding.
 *
 * Per CLAUDE.md / build plan §5.2: HALF_EVEN ('banker's rounding')
 * is the default; HALF_UP is the override for Reg Z disclosures
 * (Phase 8). Other modes are exposed for completeness but should be
 * deliberate.
 *
 * Decimal.js's rounding-mode constants:
 *   ROUND_UP        = 0
 *   ROUND_DOWN      = 1
 *   ROUND_CEIL      = 2
 *   ROUND_FLOOR     = 3
 *   ROUND_HALF_UP   = 4
 *   ROUND_HALF_DOWN = 5
 *   ROUND_HALF_EVEN = 6
 *   ROUND_HALF_CEIL = 7
 *   ROUND_HALF_FLOOR= 8
 */

export type RoundingMode = "half-even" | "half-up" | "half-down" | "ceil" | "floor" | "up" | "down";

const MODE_TO_DECIMAL: Record<RoundingMode, Decimal.Rounding> = {
  "half-even": Decimal.ROUND_HALF_EVEN,
  "half-up": Decimal.ROUND_HALF_UP,
  "half-down": Decimal.ROUND_HALF_DOWN,
  ceil: Decimal.ROUND_CEIL,
  floor: Decimal.ROUND_FLOOR,
  up: Decimal.ROUND_UP,
  down: Decimal.ROUND_DOWN,
};

export const DEFAULT_ROUNDING_MODE: RoundingMode = "half-even";

/**
 * Round a Money value to the specified number of decimal places
 * (default 2 — cents).
 */
export function roundMoney(
  value: Money,
  decimalPlaces = 2,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): Money {
  return money(value.toDecimalPlaces(decimalPlaces, MODE_TO_DECIMAL[mode]));
}

/** Round to whole dollars. Same default mode. */
export const roundToDollars = (value: Money, mode?: RoundingMode): Money =>
  roundMoney(value, 0, mode);

/** Round to thousandths-of-a-cent (used by some interest computations). */
export const roundToMills = (value: Money, mode?: RoundingMode): Money =>
  roundMoney(value, 4, mode);
