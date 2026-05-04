import { describe, expect, it } from "vitest";
import { money, rate } from "../types.js";
import {
  buildRegZDisclosure,
  classifyFinanceCharges,
  computeApr,
  type FinanceCharge,
} from "../reg-z.js";

describe("classifyFinanceCharges", () => {
  it("buckets prepaid / interest / financed and sums total", () => {
    const charges: FinanceCharge[] = [
      { id: "origination", description: "Origination fee", kind: "prepaid", amount: money("500") },
      { id: "interest", description: "Note interest", kind: "interest", amount: money("12000") },
      {
        id: "credit-life",
        description: "Credit life premium",
        kind: "financed",
        amount: money("250"),
      },
    ];
    const out = classifyFinanceCharges(charges);
    expect(out.prepaid.toFixed(2)).toBe("500.00");
    expect(out.interest.toFixed(2)).toBe("12000.00");
    expect(out.financed.toFixed(2)).toBe("250.00");
    expect(out.totalFinanceCharge.toFixed(2)).toBe("12750.00");
  });
});

describe("computeApr", () => {
  it("recovers a known 6% APR from a level-payment 30-year mortgage with no prepaid charges", () => {
    // PV=200,000 at 0.5%/month for 360 months → PMT=$1199.10
    const result = computeApr({
      loanProceeds: money("200000"),
      paymentAmount: money("1199.1011937618"),
      numberOfPayments: 360,
      paymentsPerYear: 12,
      prepaidFinanceCharges: money("0"),
    });
    expect(result.apr.toNumber()).toBeCloseTo(0.06, 5);
    expect(result.periodicRate.toNumber()).toBeCloseTo(0.005, 6);
  });

  it("APR rises above the note rate when there are prepaid finance charges", () => {
    // Same note rate (6% APR on note), but $2,000 of prepaid charges
    // mean the borrower only receives $198,000 → effective APR > 6%.
    const result = computeApr({
      loanProceeds: money("200000"),
      paymentAmount: money("1199.1011937618"),
      numberOfPayments: 360,
      paymentsPerYear: 12,
      prepaidFinanceCharges: money("2000"),
    });
    expect(result.apr.toNumber()).toBeGreaterThan(0.06);
    expect(result.amountFinanced.toFixed(2)).toBe("198000.00");
  });

  it("Amount Financed identity: totalOfPayments − amountFinanced = financeCharge", () => {
    const result = computeApr({
      loanProceeds: money("50000"),
      paymentAmount: money("962.55"),
      numberOfPayments: 60,
      paymentsPerYear: 12,
      prepaidFinanceCharges: money("250"),
    });
    const sum = result.totalOfPayments
      .minus(result.amountFinanced)
      .minus(result.totalFinanceCharge);
    expect(sum.abs().toNumber()).toBeLessThan(0.01);
  });

  it("tolerance check: APR within 0.125% of a target reports regular=true", () => {
    const result = computeApr(
      {
        loanProceeds: money("200000"),
        paymentAmount: money("1199.1011937618"),
        numberOfPayments: 360,
        paymentsPerYear: 12,
        prepaidFinanceCharges: money("0"),
      },
      rate("0.06"),
    );
    expect(result.withinTolerance.regular).toBe(true);
    expect(result.withinTolerance.irregular).toBe(true);
  });

  it("tolerance check: APR ≥ 0.125% off target → regular=false, irregular=true", () => {
    const result = computeApr(
      {
        loanProceeds: money("200000"),
        paymentAmount: money("1199.1011937618"),
        numberOfPayments: 360,
        paymentsPerYear: 12,
        prepaidFinanceCharges: money("0"),
      },
      rate("0.062"), // 0.2% off target → outside ±0.125% but inside ±0.25%
    );
    expect(result.withinTolerance.regular).toBe(false);
    expect(result.withinTolerance.irregular).toBe(true);
  });
});

describe("buildRegZDisclosure", () => {
  it("constructs the documented shape and the identity-check passes", () => {
    const disc = buildRegZDisclosure({
      loanProceeds: money("10000"),
      paymentAmount: money("199.08"),
      numberOfPayments: 60,
      paymentsPerYear: 12,
      prepaidFinanceCharges: money("0"),
      lateChargeText: "5% of any payment more than 15 days late.",
      securityInterestText: "Subject of the loan: 2024 Toyota Camry, VIN ...",
      prepaymentText: "You will not have to pay a penalty for early payoff.",
      assumabilityText: "Someone buying your car cannot assume the remainder of the loan.",
    });
    expect(disc.apr.toNumber()).toBeGreaterThan(0.06);
    expect(disc.apr.toNumber()).toBeLessThan(0.1);
    expect(disc.paymentSchedule.length).toBe(60);
    expect(disc.identityCheck.passes).toBe(true);
    expect(disc.lateChargeText).toMatch(/15 days/);
    expect(disc.assumabilityText).toMatch(/cannot assume/);
  });

  it("balloon is folded into the last payment", () => {
    const disc = buildRegZDisclosure({
      loanProceeds: money("100000"),
      paymentAmount: money("500"),
      numberOfPayments: 60,
      paymentsPerYear: 12,
      prepaidFinanceCharges: money("0"),
      balloonAmount: money("80000"),
    });
    const last = disc.paymentSchedule[disc.paymentSchedule.length - 1]!;
    expect(last.amount.toNumber()).toBeCloseTo(80500, 0);
  });
});
