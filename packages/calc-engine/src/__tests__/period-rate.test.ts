import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { rate } from "../types.js";
import {
  effectiveToNominal,
  nominalToEffective,
  nominalToPeriodic,
  periodToPeriod,
} from "../period-rate.js";

describe("nominalToPeriodic", () => {
  it("12% APR / monthly = 1% per period", () => {
    expect(nominalToPeriodic(rate("0.12"), "monthly").toNumber()).toBeCloseTo(0.01);
  });

  it("4% APR / quarterly = 1% per period", () => {
    expect(nominalToPeriodic(rate("0.04"), "quarterly").toNumber()).toBeCloseTo(0.01);
  });
});

describe("nominalToEffective", () => {
  it("12% APR / monthly EAR ≈ 12.6825%", () => {
    expect(nominalToEffective(rate("0.12"), "monthly").toNumber()).toBeCloseTo(0.126825, 5);
  });

  it("12% APR / continuous EAR = e^0.12 - 1 ≈ 12.7497%", () => {
    expect(nominalToEffective(rate("0.12"), "continuous").toNumber()).toBeCloseTo(0.127497, 5);
  });

  it("annual nominal = annual effective", () => {
    fc.assert(
      fc.property(fc.double({ min: -0.5, max: 0.5, noNaN: true }), (r) => {
        if (!Number.isFinite(r)) return;
        expect(nominalToEffective(rate(r.toString()), "annual").toNumber()).toBeCloseTo(r, 9);
      }),
    );
  });
});

describe("nominalToEffective ↔ effectiveToNominal round-trip", () => {
  it("identity within fp error for the major intervals", () => {
    const intervals = ["monthly", "quarterly", "semi-annual", "annual", "continuous"] as const;
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 0.5, noNaN: true }), (r) => {
        for (const iv of intervals) {
          const ear = nominalToEffective(rate(r.toString()), iv);
          const back = effectiveToNominal(ear, iv);
          expect(back.toNumber()).toBeCloseTo(r, 9);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("periodToPeriod", () => {
  it("monthly nominal -> annual nominal preserves EAR", () => {
    const monthly = rate("0.12");
    const annual = periodToPeriod(monthly, "monthly", "annual");
    // Annual nominal under m=1 IS the EAR; check vs nominalToEffective.
    expect(annual.toNumber()).toBeCloseTo(nominalToEffective(monthly, "monthly").toNumber(), 9);
  });

  it("monthly nominal -> quarterly nominal -> monthly nominal is identity", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 0.3, noNaN: true }), (r) => {
        const m = rate(r.toString());
        const q = periodToPeriod(m, "monthly", "quarterly");
        const m2 = periodToPeriod(q, "quarterly", "monthly");
        expect(m2.toNumber()).toBeCloseTo(r, 9);
      }),
      { numRuns: 50 },
    );
  });
});
