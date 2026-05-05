import { describe, expect, it } from "vitest";
import { money, rate } from "../types.js";
import {
  asc842LeasePv,
  bondYield,
  imputedInterest7872,
  irr,
  leaseRateFactor,
  mirr,
  noteBuySellYield,
  npv,
  priceBond,
  sinkingFund,
  tdrImpairment,
} from "../templates.js";

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

describe("tdrImpairment (Phase 9.5)", () => {
  it("recognizes impairment when restructured PV is below carrying", () => {
    // $100k loan, restructured to 5 annual payments of $19k starting in
    // 1 year. Original effective rate 8%. PV = 19000 * [1−(1.08)^-5]/0.08
    // ≈ $75,866. Impairment ≈ $24,134.
    const result = tdrImpairment({
      carryingAmount: money("100000"),
      originalEffectiveRate: rate("0.08"),
      restructuredFlows: [
        { date: utc(2026, 1, 1), amount: money("19000") },
        { date: utc(2027, 1, 1), amount: money("19000") },
        { date: utc(2028, 1, 1), amount: money("19000") },
        { date: utc(2029, 1, 1), amount: money("19000") },
        { date: utc(2030, 1, 1), amount: money("19000") },
      ],
      valuationDate: utc(2025, 1, 1),
    });
    expect(result.presentValue.toNumber()).toBeCloseTo(75866, -2);
    expect(result.impairment.toNumber()).toBeGreaterThan(20000);
    expect(result.impairment.toNumber()).toBeLessThan(30000);
  });

  it("returns zero impairment when PV exceeds carrying", () => {
    const result = tdrImpairment({
      carryingAmount: money("50000"),
      originalEffectiveRate: rate("0.05"),
      restructuredFlows: [{ date: utc(2025, 6, 1), amount: money("70000") }],
      valuationDate: utc(2025, 1, 1),
    });
    expect(result.impairment.toFixed(2)).toBe("0.00");
  });
});

describe("imputedInterest7872 (Phase 9.6/9.7)", () => {
  it("interest-free term loan: foregone = principal × AFR", () => {
    const r = imputedInterest7872({
      principal: money("100000"),
      termYears: 5,
      afr: rate("0.045"),
      statedRate: rate("0"),
      paymentsPerYear: 12,
      loanType: "term",
    });
    expect(r.annualForegoneInterest.toFixed(2)).toBe("4500.00");
    expect(r.totalImputedInterest.toFixed(2)).toBe("22500.00");
    expect(r.originalIssueDiscount).not.toBeNull();
  });

  it("demand loan returns null OID/PV (no PV computation)", () => {
    const r = imputedInterest7872({
      principal: money("50000"),
      termYears: 3,
      afr: rate("0.04"),
      statedRate: rate("0.01"),
      paymentsPerYear: 12,
      loanType: "demand",
    });
    expect(r.presentValueAtAfr).toBeNull();
    expect(r.originalIssueDiscount).toBeNull();
    expect(r.annualForegoneInterest.toFixed(2)).toBe("1500.00"); // 50000 * 0.03
  });
});

describe("leaseRateFactor (Phase 9.9)", () => {
  it("computes rate factor and recovers a sane implicit rate", () => {
    // $50k equipment, $1100/mo for 60 months, $5k residual.
    const r = leaseRateFactor({
      equipmentCost: money("50000"),
      monthlyPayment: money("1100"),
      termMonths: 60,
      residualValue: money("5000"),
    });
    // Factor = 1100 / 50000 = 0.022
    expect(r.rateFactor.toFixed(4)).toBe("0.0220");
    // Implicit annual rate should be in the single-digit % range.
    expect(r.implicitAnnualRate.toNumber()).toBeGreaterThan(0.05);
    expect(r.implicitAnnualRate.toNumber()).toBeLessThan(0.15);
  });
});

describe("noteBuySellYield (Phase 9.10)", () => {
  it("buyer paying the remaining balance gets the original rate", () => {
    // 24 monthly payments of $470.73 on a $10k note, no balloon.
    // Standard amortization at 12%/yr nominal monthly. Buyer pays
    // exactly $10k → yield ≈ 12%.
    const r = noteBuySellYield({
      remainingBalance: money("10000"),
      payment: money("470.73"),
      remainingPayments: 24,
      paymentsPerYear: 12,
      purchasePrice: money("10000"),
    });
    expect(r.buyerYield.toNumber()).toBeCloseTo(0.12, 2);
    expect(r.discountPct.toNumber()).toBeCloseTo(0, 4);
  });

  it("buying at a discount lifts the yield", () => {
    const at_par = noteBuySellYield({
      remainingBalance: money("10000"),
      payment: money("470.73"),
      remainingPayments: 24,
      paymentsPerYear: 12,
      purchasePrice: money("10000"),
    });
    const at_discount = noteBuySellYield({
      remainingBalance: money("10000"),
      payment: money("470.73"),
      remainingPayments: 24,
      paymentsPerYear: 12,
      purchasePrice: money("9000"),
    });
    expect(at_discount.buyerYield.toNumber()).toBeGreaterThan(at_par.buyerYield.toNumber());
    expect(at_discount.discountPct.toNumber()).toBeCloseTo(0.1, 4);
  });
});
