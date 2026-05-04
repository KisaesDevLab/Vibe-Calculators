import Decimal from "decimal.js";
import { rate, type Rate } from "./types.js";
import { periodsPerYear, type CompoundingInterval } from "./compounding.js";

/**
 * Phase 5.6 — period-rate conversions.
 *
 * Conventions:
 *   - "nominal annual rate compounded m times per year" (APR-ish):
 *     periodic rate = nominal / m
 *   - "effective annual rate" (EAR):
 *     EAR = (1 + nominal/m)^m - 1
 *   - "continuously compounded annual rate":
 *     EAR = e^r - 1
 *
 * All inputs and outputs are Rate (decimal fraction). NaN / Infinity
 * propagation is rejected by the constructors.
 */

/** Periodic rate for one period under the given interval, given a nominal annual rate. */
export function nominalToPeriodic(nominal: Rate, interval: CompoundingInterval): Rate {
  const m = periodsPerYear(interval);
  if (m === null) {
    throw new Error(`No discrete period count for interval '${interval}'`);
  }
  return rate(nominal.div(m));
}

/** EAR from a nominal-annual + interval. */
export function nominalToEffective(nominal: Rate, interval: CompoundingInterval): Rate {
  if (interval === "continuous") {
    return rate(nominal.exp().minus(1));
  }
  const m = periodsPerYear(interval);
  if (m === null) {
    throw new Error(`Cannot compute EAR for '${interval}' without an explicit period count`);
  }
  return rate(new Decimal(1).plus(nominal.div(m)).pow(m).minus(1));
}

/** Nominal annual rate from EAR + compounding interval. */
export function effectiveToNominal(effective: Rate, interval: CompoundingInterval): Rate {
  if (interval === "continuous") {
    return rate(new Decimal(1).plus(effective).ln());
  }
  const m = periodsPerYear(interval);
  if (m === null) {
    throw new Error(
      `Cannot reconstruct nominal for '${interval}' without an explicit period count`,
    );
  }
  // (1+EAR)^(1/m) - 1 = periodic; nominal = periodic * m
  const periodic = new Decimal(1).plus(effective).pow(new Decimal(1).div(m)).minus(1);
  return rate(periodic.times(m));
}

/**
 * Convert a nominal rate stated under one interval to the equivalent
 * nominal rate under another. Implemented as nominal -> EAR -> nominal.
 */
export function periodToPeriod(
  nominal: Rate,
  fromInterval: CompoundingInterval,
  toInterval: CompoundingInterval,
): Rate {
  if (fromInterval === toInterval) return nominal;
  const ear = nominalToEffective(nominal, fromInterval);
  return effectiveToNominal(ear, toInterval);
}
