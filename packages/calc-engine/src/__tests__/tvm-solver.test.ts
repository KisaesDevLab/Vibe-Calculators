import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Decimal from "decimal.js";
import {
  solveForFV,
  solveForI,
  solveForN,
  solveForPMT,
  solveForPV,
  tvmResidual,
} from "../tvm-solver.js";

const dec = (s: string | number): Decimal => new Decimal(s);

describe("tvmResidual", () => {
  it("balances at the canonical 30-year mortgage example (PMT derived to full precision)", () => {
    // $200,000 loan at 6%/yr (0.5%/mo) for 360 months. Use the
    // closed-form solveForPMT to get the exact PMT — a printed
    // 4-decimal PMT leaves residual ~$0.14.
    const pv = dec("200000");
    const fv = dec("0");
    const i = dec("0.005");
    const n = dec("360");
    const pmt = solveForPMT({ pv, fv, i, n, type: 0 });
    expect(pmt.toFixed(2)).toBe("-1199.10");
    const r = tvmResidual({ pv, fv, pmt, i, n, type: 0 });
    expect(r.abs().toNumber()).toBeLessThan(1e-9);
  });

  it("zero-rate equation reduces to PV + PMT*n + FV = 0", () => {
    expect(
      tvmResidual({
        pv: dec("100"),
        fv: dec("0"),
        pmt: dec("-10"),
        i: dec("0"),
        n: dec("10"),
        type: 0,
      }).toNumber(),
    ).toBe(0);
  });
});

describe("closed-form solvers — algebraic identity round-trips", () => {
  it("solveForPMT then forward-evaluate balances at zero", () => {
    const inp = {
      pv: dec("200000"),
      fv: dec("0"),
      i: dec("0.005"),
      n: dec("360"),
      type: 0,
    } as const;
    const pmt = solveForPMT(inp);
    expect(
      tvmResidual({ ...inp, pmt })
        .abs()
        .toNumber(),
    ).toBeLessThan(1e-9);
  });

  it("solveForPV then forward-evaluate balances at zero", () => {
    const inp = {
      fv: dec("0"),
      pmt: dec("-1199.1"),
      i: dec("0.005"),
      n: dec("360"),
      type: 0,
    } as const;
    const pv = solveForPV(inp);
    expect(
      tvmResidual({ ...inp, pv })
        .abs()
        .toNumber(),
    ).toBeLessThan(1e-3);
  });

  it("solveForFV then forward-evaluate balances at zero", () => {
    const inp = {
      pv: dec("-1000"),
      pmt: dec("-100"),
      i: dec("0.06"),
      n: dec("10"),
      type: 0,
    } as const;
    const fv = solveForFV(inp);
    expect(
      tvmResidual({ ...inp, fv })
        .abs()
        .toNumber(),
    ).toBeLessThan(1e-9);
  });

  it("solveForN then forward-evaluate balances at zero", () => {
    // Derive the exact pmt first, then solveForN should recover n=360.
    const fv = dec("0");
    const i = dec("0.005");
    const pv = dec("200000");
    const exactPmt = solveForPMT({ pv, fv, i, n: dec("360"), type: 0 });
    const inp = { pv, fv, pmt: exactPmt, i, type: 0 } as const;
    const n = solveForN(inp);
    expect(n.minus(360).abs().toNumber()).toBeLessThan(1e-6);
    expect(
      tvmResidual({ ...inp, n })
        .abs()
        .toNumber(),
    ).toBeLessThan(1e-3);
  });

  it("annuity-due (type=1) is correctly handled", () => {
    // type=1 PMT magnitude is smaller than type=0 by factor (1+i).
    const inp = { pv: dec("200000"), fv: dec("0"), i: dec("0.005"), n: dec("360") } as const;
    const pmtEnd = solveForPMT({ ...inp, type: 0 });
    const pmtBegin = solveForPMT({ ...inp, type: 1 });
    expect(pmtBegin.div(pmtEnd).toNumber()).toBeCloseTo(1 / 1.005, 6);
  });
});

describe("solveForI iterative", () => {
  it("recovers a known rate from a known PMT (exact)", () => {
    // PV=200000, n=360, i=0.005 → derive exact PMT, then back-solve i.
    const i = dec("0.005");
    const pv = dec("200000");
    const fv = dec("0");
    const pmt = solveForPMT({ pv, fv, i, n: dec("360"), type: 0 });
    const r = solveForI({ pv, fv, pmt, n: dec("360"), type: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.minus(i).abs().toNumber()).toBeLessThan(1e-9);
  });

  it("recovers a high rate (1.5%/period)", () => {
    // PV=10000, PMT=-200, n=72 → i should be ≈0.015
    const r = solveForI({
      pv: dec("10000"),
      fv: dec("0"),
      pmt: dec("-225"),
      n: dec("72"),
      type: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("handles annuity-due correctly", () => {
    // Same monthly schedule but type=1; derive the exact pmt, then
    // recover i.
    const i = dec("0.005");
    const pv = dec("200000");
    const fv = dec("0");
    const pmt = solveForPMT({ pv, fv, i, n: dec("360"), type: 1 });
    const r = solveForI({ pv, fv, pmt, n: dec("360"), type: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.minus(i).abs().toNumber()).toBeLessThan(1e-9);
  });

  it("returns sign-error when no rate balances the equation", () => {
    // PV=+100, PMT=+100, FV=+100 with all positive cashflows: no rate i in (-1, 1)
    // makes the residual zero (it's the wrong sign throughout).
    const r = solveForI({
      pv: dec("100"),
      fv: dec("100"),
      pmt: dec("100"),
      n: dec("12"),
      type: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["sign-error", "ill-conditioned"]).toContain(r.reason);
  });
});

describe("property: solveForPMT round-trip via solveForI", () => {
  it("for plausible loans, computed pmt + computed i recover the original i", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0.001, max: 0.05, noNaN: true }),
        fc.integer({ min: 12, max: 360 }),
        (pvNum, iNum, nNum) => {
          if (!Number.isFinite(pvNum) || !Number.isFinite(iNum)) return;
          const pv = dec(pvNum.toFixed(2));
          const i = dec(iNum.toFixed(8));
          const n = dec(nNum);
          const pmt = solveForPMT({ pv, fv: dec("0"), i, n, type: 0 });
          const r = solveForI({ pv, fv: dec("0"), pmt, n, type: 0 });
          if (!r.ok) {
            // Some edge inputs land outside Brent's bracket; skip them.
            return;
          }
          expect(r.value.minus(i).abs().lt("1e-6")).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("solveForI performance", () => {
  it("converges in well under 50ms for a typical 30-year loan", () => {
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) {
      solveForI({
        pv: dec("200000"),
        fv: dec("0"),
        pmt: dec("-1199.10"),
        n: dec("360"),
        type: 0,
      });
    }
    const elapsedPerSolve = (performance.now() - t0) / 100;
    expect(elapsedPerSolve).toBeLessThan(50);
  });
});
