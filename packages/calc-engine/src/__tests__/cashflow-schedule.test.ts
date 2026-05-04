import { describe, expect, it } from "vitest";
import { money, rate } from "../types.js";
import { generateSchedule, expandSeries } from "../cashflow-schedule.js";
import { validateEvents } from "../cashflow-events.js";
import type { CashFlowEvent, MasterCalculationSettings } from "../cashflow-events.js";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

const masterMonthly: MasterCalculationSettings = {
  rate: rate("0.06"), // 6% nominal annual
  compounding: "monthly",
  dayCount: "30/360",
  paymentTiming: 0,
  computeMethod: "Normal",
};

describe("generateSchedule — Normal compute", () => {
  it("simple loan + 12 monthly payments produces 13 rows", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("12000") },
      {
        date: utc(2025, 2, 1),
        kind: "payment",
        amount: money("1080"), // approx amortization
        count: 12,
        interval: "monthly",
      },
    ];
    const result = generateSchedule(events, masterMonthly);
    expect(result.rows.length).toBe(13);
    expect(result.rows[0]?.kind).toBe("loan");
  });

  it("interest-only series leaves the principal balance unchanged", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("100000") },
      {
        date: utc(2025, 2, 1),
        kind: "interest_only",
        count: 12,
        interval: "monthly",
      },
    ];
    const result = generateSchedule(events, masterMonthly);
    expect(result.endingBalance.toFixed(2)).toBe("100000.00");
    // 12 months of interest-only payments at 6%/yr ≈ 12 * 500 = 6000.
    expect(result.totalInterest.toNumber()).toBeCloseTo(6000, 0);
  });

  it("rate_change flips the active rate from its date forward", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("100000") },
      { date: utc(2026, 1, 1), kind: "rate_change", rate: rate("0.04") },
      // Year 1 at 6% interest-only → ~6000; year 2 at 4% → ~4000
      { date: utc(2025, 2, 1), kind: "interest_only", count: 12, interval: "monthly" },
      { date: utc(2026, 2, 1), kind: "interest_only", count: 12, interval: "monthly" },
    ];
    const result = generateSchedule(events, masterMonthly);
    expect(result.endingBalance.toFixed(2)).toBe("100000.00");
    expect(result.totalInterest.toNumber()).toBeCloseTo(10000, 0);
    // The rate_change row should record the new rate.
    const rateChangeRow = result.rows.find((r) => r.kind === "rate_change");
    expect(rateChangeRow?.rate.toString()).toBe("0.04");
  });

  it("negative amortization is detected when payment < accrued interest", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("100000") },
      { date: utc(2025, 2, 1), kind: "payment", amount: money("100") }, // way less than ~500 interest
    ];
    const result = generateSchedule(events, masterMonthly);
    expect(result.hasNegativeAm).toBe(true);
  });

  it("stepped_amount expands into N payments with arithmetic step", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("100000") },
      {
        date: utc(2025, 2, 1),
        kind: "stepped_amount",
        amount: money("500"),
        count: 4,
        interval: "monthly",
        seriesOptions: { stepAmount: money("50"), stepEvery: 1 },
      },
    ];
    const expanded = expandSeries(events);
    // 1 loan + 4 payments
    expect(expanded.length).toBe(5);
    const payments = expanded.filter((e) => e.kind === "payment");
    expect(payments.map((p) => p.amount?.toNumber())).toEqual([500, 550, 600, 650]);
  });

  it("memo events do not affect balance or totals", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("10000") },
      { date: utc(2025, 6, 1), kind: "memo", memo: "Mid-year status note" },
    ];
    const result = generateSchedule(events, masterMonthly);
    expect(result.rows[1]?.kind).toBe("memo");
    expect(result.rows[1]?.memo).toBe("Mid-year status note");
    // Balance grew only via accrued interest (6% * 5/12 ≈ 250).
    const closeAfterMemo = result.rows[1]?.closing.toNumber() ?? 0;
    expect(closeAfterMemo).toBeCloseTo(10000, 0);
  });

  it("cumulative totals are monotonic", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("50000") },
      {
        date: utc(2025, 2, 1),
        kind: "payment",
        amount: money("1000"),
        count: 24,
        interval: "monthly",
      },
    ];
    const result = generateSchedule(events, masterMonthly);
    let prevInt = 0;
    let prevPrin = 0;
    for (const r of result.rows) {
      expect(r.cumulativeInterest.toNumber()).toBeGreaterThanOrEqual(prevInt);
      expect(r.cumulativePrincipal.toNumber()).toBeGreaterThanOrEqual(prevPrin);
      prevInt = r.cumulativeInterest.toNumber();
      prevPrin = r.cumulativePrincipal.toNumber();
    }
  });
});

describe("validateEvents", () => {
  it("rate_change without a rate is flagged", () => {
    const issues = validateEvents([{ date: utc(2025, 1, 1), kind: "rate_change" }], masterMonthly);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("rate");
  });

  it("stepped_amount with zero step is flagged", () => {
    const issues = validateEvents(
      [
        {
          date: utc(2025, 1, 1),
          kind: "stepped_amount",
          amount: money("100"),
          seriesOptions: { stepAmount: money("0"), stepEvery: 1 },
        },
      ],
      masterMonthly,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("seriesOptions.stepAmount");
  });

  it("calendar_month_skip with out-of-range or duplicate months is flagged", () => {
    const issues = validateEvents(
      [
        {
          date: utc(2025, 1, 1),
          kind: "calendar_month_skip",
          seriesOptions: { skipMonths: [6, 7, 13, 6] },
        },
      ],
      masterMonthly,
    );
    expect(issues.length).toBeGreaterThanOrEqual(2);
    const fields = issues.map((i) => i.message);
    expect(fields.some((m) => m.includes("13"))).toBe(true);
    expect(fields.some((m) => m.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it("principal_applied_first under non-USRule is flagged", () => {
    const issues = validateEvents(
      [{ date: utc(2025, 1, 1), kind: "principal_applied_first" }],
      masterMonthly,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("master.computeMethod");
  });

  it("existing_note_valuation without a yieldRate is flagged", () => {
    const issues = validateEvents(
      [{ date: utc(2025, 1, 1), kind: "existing_note_valuation" }],
      masterMonthly,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("seriesOptions.yieldRate");
  });

  it("a fully-valid event list yields no issues", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("100000") },
      { date: utc(2025, 6, 1), kind: "rate_change", rate: rate("0.05") },
      {
        date: utc(2025, 7, 1),
        kind: "stepped_amount",
        amount: money("500"),
        seriesOptions: { stepAmount: money("25"), stepEvery: 1 },
      },
    ];
    expect(validateEvents(events, masterMonthly)).toEqual([]);
  });
});
