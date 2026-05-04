import Decimal from "decimal.js";

/**
 * Phase 5.1 — Money and Rate branded types.
 *
 * Both wrap decimal.js so currency / interest math never round-trips
 * through JS Number. Branded types make `Money` and `Rate` mutually
 * non-assignable and unmistakable for `Decimal` so callers can't
 * accidentally mix them.
 *
 * Constructors validate range:
 *   - Money allows any finite decimal (negatives represent outflows
 *     in the build-plan convention; the value range isn't bounded
 *     by the type — domain code that wants positive-only money uses
 *     the unsignedMoney() helper).
 *   - Rate is a fraction (not a percent). 0.065 == 6.5%. Range
 *     enforcement is permissive: the type accepts negative rates
 *     (some calculators surface them, e.g. negative inflation
 *     scenarios), but rejects NaN / Infinity.
 */

declare const MoneyBrand: unique symbol;
declare const RateBrand: unique symbol;

export type Money = Decimal & { readonly [MoneyBrand]: true };
export type Rate = Decimal & { readonly [RateBrand]: true };

const ZERO_MONEY = new Decimal(0) as Money;
const ZERO_RATE = new Decimal(0) as Rate;

export class MoneyRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyRangeError";
  }
}

export class RateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateRangeError";
  }
}

/**
 * Construct a Money from a string, number, or Decimal.
 *
 * Strings are preferred — they preserve exact precision the caller
 * typed. Numbers are accepted but get parsed through decimal.js
 * (which handles them losslessly for inputs that survived a
 * Number round-trip).
 */
export function money(input: string | number | Decimal): Money {
  const d = toDecimal(input);
  if (!d.isFinite()) {
    throw new MoneyRangeError(`Money must be finite: got ${String(input)}`);
  }
  return d as Money;
}

/** Same as money() but rejects negatives. Use when domain demands ≥0. */
export function unsignedMoney(input: string | number | Decimal): Money {
  const m = money(input);
  if (m.isNeg()) {
    throw new MoneyRangeError(`Money must be non-negative: got ${m.toString()}`);
  }
  return m;
}

/**
 * Construct a Rate from a string, number, or Decimal. `input` is the
 * fraction (0.065 for 6.5%). Use rateFromPercent() for the percent
 * form.
 */
export function rate(input: string | number | Decimal): Rate {
  let d: Decimal;
  try {
    d = toDecimal(input);
  } catch {
    throw new RateRangeError(`Rate must be finite: got ${String(input)}`);
  }
  if (!d.isFinite()) {
    throw new RateRangeError(`Rate must be finite: got ${String(input)}`);
  }
  return d as Rate;
}

/** Convenience: rateFromPercent(6.5) === rate(0.065). */
export function rateFromPercent(pct: string | number | Decimal): Rate {
  return rate(toDecimal(pct).div(100));
}

export function isMoney(value: unknown): value is Money {
  return Decimal.isDecimal(value) && Object.prototype.hasOwnProperty.call(value, "constructor");
}

export function isRate(value: unknown): value is Rate {
  return isMoney(value as Money);
}

export const moneyZero = (): Money => ZERO_MONEY;
export const rateZero = (): Rate => ZERO_RATE;

function toDecimal(input: string | number | Decimal): Decimal {
  if (input instanceof Decimal) return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new MoneyRangeError(`Number input is not finite: ${String(input)}`);
    }
    return new Decimal(input);
  }
  return new Decimal(input);
}
