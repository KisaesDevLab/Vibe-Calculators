import { describe, expect, it } from "vitest";
import {
  money,
  moneyZero,
  MoneyRangeError,
  rate,
  rateFromPercent,
  rateZero,
  RateRangeError,
  unsignedMoney,
} from "../types.js";
import { DEFAULT_ROUNDING_MODE, roundMoney, roundToDollars, roundToMills } from "../rounding.js";

describe("Money / Rate constructors", () => {
  it("money() accepts strings, numbers, decimals", () => {
    expect(money("1234.56").toFixed(2)).toBe("1234.56");
    expect(money(1234.56).toFixed(2)).toBe("1234.56");
  });

  it("money() rejects NaN and Infinity", () => {
    expect(() => money(Number.NaN)).toThrow(MoneyRangeError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(MoneyRangeError);
  });

  it("unsignedMoney() rejects negatives", () => {
    expect(() => unsignedMoney("-1")).toThrow(MoneyRangeError);
    expect(unsignedMoney("0.01").toString()).toBe("0.01");
  });

  it("rate() and rateFromPercent() are equivalent on round-trip", () => {
    expect(rateFromPercent(6.5).toString()).toBe(rate("0.065").toString());
  });

  it("rate() rejects non-finite", () => {
    expect(() => rate(Number.NaN)).toThrow(RateRangeError);
  });

  it("zero constants", () => {
    expect(moneyZero().toString()).toBe("0");
    expect(rateZero().toString()).toBe("0");
  });
});

describe("rounding", () => {
  it("default mode is half-even (banker's)", () => {
    expect(DEFAULT_ROUNDING_MODE).toBe("half-even");
  });

  it("banker's rounding: 0.005 → 0 (round to even)", () => {
    expect(roundMoney(money("0.005"), 2).toString()).toBe("0");
  });

  it("banker's rounding: 0.015 → 0.02 (round to even)", () => {
    expect(roundMoney(money("0.015"), 2).toString()).toBe("0.02");
  });

  it("half-up override (Reg Z disclosure path)", () => {
    expect(roundMoney(money("0.005"), 2, "half-up").toString()).toBe("0.01");
  });

  it("rounds whole dollars and mills", () => {
    expect(roundToDollars(money("123.49")).toString()).toBe("123");
    expect(roundToDollars(money("123.50")).toString()).toBe("124");
    expect(roundToMills(money("0.123456")).toString()).toBe("0.1235");
  });
});
