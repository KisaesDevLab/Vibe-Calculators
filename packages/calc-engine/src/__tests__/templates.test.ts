import { describe, expect, it } from "vitest";
import { money, rate } from "../types.js";
import { asc842LeasePv, bondYield, irr, mirr, npv, priceBond, sinkingFund } from "../templates.js";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

describe("priceBond", () => {
  it("par bond (coupon = yield) trades at par on a coupon date", () => {
    const result = priceBond({
      face: money("1000"),
      couponRate: rate("0.05"),
      paymentsPerYear: 2,
      settle: utc(2025, 1, 1),
      maturity: utc(2035, 1, 1),
      yieldRate: rate("0.05"),
    });
    expect(result.cleanPrice.toNumber()).toBeCloseTo(1000, 2);
  });

  it("premium bond (coupon > yield) trades above par", () => {
    const result = priceBond({
      face: money("1000"),
      couponRate: rate("0.07"),
      paymentsPerYear: 2,
      settle: utc(2025, 1, 1),
      maturity: utc(2035, 1, 1),
      yieldRate: rate("0.05"),
    });
    expect(result.cleanPrice.toNumber()).toBeGreaterThan(1000);
  });

  it("discount bond (coupon < yield) trades below par", () => {
    const result = priceBond({
      face: money("1000"),
      couponRate: rate("0.03"),
      paymentsPerYear: 2,
      settle: utc(2025, 1, 1),
      maturity: utc(2035, 1, 1),
      yieldRate: rate("0.05"),
    });
    expect(result.cleanPrice.toNumber()).toBeLessThan(1000);
  });
});

describe("bondYield", () => {
  it("recovers the yield from a price computed by priceBond", () => {
    const target = priceBond({
      face: money("1000"),
      couponRate: rate("0.05"),
      paymentsPerYear: 2,
      settle: utc(2025, 1, 1),
      maturity: utc(2035, 1, 1),
      yieldRate: rate("0.06"),
    });
    const ytm = bondYield({
      face: money("1000"),
      couponRate: rate("0.05"),
      paymentsPerYear: 2,
      settle: utc(2025, 1, 1),
      maturity: utc(2035, 1, 1),
      cleanPrice: target.cleanPrice,
    });
    expect(ytm.toNumber()).toBeCloseTo(0.06, 4);
  });
});

describe("asc842LeasePv", () => {
  it("liability = PV of payments; ROU = liability + IDC + prepay − incentives", () => {
    const r = asc842LeasePv({
      paymentAmount: money("1000"),
      numberOfPayments: 60,
      paymentsPerYear: 12,
      discountRate: rate("0.05"),
      initialDirectCosts: money("3000"),
      leaseIncentives: money("2000"),
      prepayments: money("500"),
    });
    // PV of $1000/mo for 60 months at 5% APR ≈ 52,990.71
    expect(r.leaseLiability.toNumber()).toBeCloseTo(52990.71, 0);
    // ROU = 52990.71 + 500 + 3000 − 2000 ≈ 54,490.71
    expect(r.rouAsset.toNumber()).toBeCloseTo(54490.71, 0);
  });

  it("annuity-due (begin-of-period) yields a higher liability than ordinary", () => {
    const ord = asc842LeasePv({
      paymentAmount: money("1000"),
      numberOfPayments: 60,
      paymentsPerYear: 12,
      discountRate: rate("0.05"),
      paymentTiming: 0,
    });
    const due = asc842LeasePv({
      paymentAmount: money("1000"),
      numberOfPayments: 60,
      paymentsPerYear: 12,
      discountRate: rate("0.05"),
      paymentTiming: 1,
    });
    expect(due.leaseLiability.toNumber()).toBeGreaterThan(ord.leaseLiability.toNumber());
  });
});

describe("npv", () => {
  it("zero discount rate ≈ sum of cash flows (regardless of dates)", () => {
    const flows = [
      { date: utc(2025, 1, 1), amount: money("-1000") },
      { date: utc(2025, 6, 1), amount: money("400") },
      { date: utc(2025, 12, 1), amount: money("400") },
      { date: utc(2026, 6, 1), amount: money("400") },
    ];
    expect(npv(flows, rate("0")).toNumber()).toBeCloseTo(200, 2);
  });

  it("higher discount rate lowers NPV of positive future cash flows", () => {
    const flows = [
      { date: utc(2025, 1, 1), amount: money("-1000") },
      { date: utc(2030, 1, 1), amount: money("1500") },
    ];
    const high = npv(flows, rate("0.10")).toNumber();
    const low = npv(flows, rate("0.02")).toNumber();
    expect(high).toBeLessThan(low);
  });
});

describe("irr", () => {
  it("simple project: -1000 invested, 1100 returned in 1 year → IRR ≈ 10%", () => {
    const r = irr([
      { date: utc(2025, 1, 1), amount: money("-1000") },
      { date: utc(2026, 1, 1), amount: money("1100") },
    ]);
    expect(r).not.toBeNull();
    expect(r?.toNumber()).toBeCloseTo(0.1, 3);
  });

  it("returns null for sign-error cash flows (all positive)", () => {
    const r = irr([
      { date: utc(2025, 1, 1), amount: money("100") },
      { date: utc(2026, 1, 1), amount: money("200") },
      { date: utc(2027, 1, 1), amount: money("300") },
    ]);
    expect(r).toBeNull();
  });
});

describe("mirr", () => {
  it("simple project: -1000 invested, 1500 in 5 years → MIRR matches IRR when finance=reinvest=IRR", () => {
    const flows = [
      { date: utc(2025, 1, 1), amount: money("-1000") },
      { date: utc(2030, 1, 1), amount: money("1500") },
    ];
    const i = irr(flows)!;
    const m = mirr(flows, i, i);
    expect(m.toNumber()).toBeCloseTo(i.toNumber(), 3);
  });
});

describe("sinkingFund", () => {
  it("required deposit accumulates to target FV", () => {
    const r = sinkingFund({
      targetFV: money("100000"),
      rate: rate("0.05"),
      numberOfPeriods: 120, // 10 years monthly
      paymentsPerYear: 12,
    });
    // Closed form: target=100000, i=0.05/12, n=120
    // factor = ((1+i)^n − 1)/i ≈ 155.28
    // deposit ≈ 100000/155.28 ≈ 643.99
    expect(r.requiredDeposit.toNumber()).toBeCloseTo(643.99, 1);
    expect(r.totalContributions.toNumber()).toBeCloseTo(643.99 * 120, 0);
    expect(r.interestEarned.toNumber()).toBeGreaterThan(0);
  });

  it("zero rate: required deposit = targetFV / n", () => {
    const r = sinkingFund({
      targetFV: money("12000"),
      rate: rate("0"),
      numberOfPeriods: 12,
      paymentsPerYear: 12,
    });
    expect(r.requiredDeposit.toNumber()).toBeCloseTo(1000, 2);
    expect(r.interestEarned.toFixed(2)).toBe("0.00");
  });
});
