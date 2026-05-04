import { describe, expect, it } from "vitest";
import { money, rate } from "../types.js";
import {
  expandSteppedPercentage,
  expandSkipPattern,
  expandCalendarMonthSkip,
  expandFixedPrincipal,
  ruleOf78Schedule,
  rollupByYear,
  rollupByFiscalYear,
  rollupByRange,
} from "../cashflow-extensions.js";
import { generateSchedule } from "../cashflow-schedule.js";
import type { CashFlowEvent, MasterCalculationSettings } from "../cashflow-events.js";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

const masterMonthly: MasterCalculationSettings = {
  rate: rate("0.06"),
  compounding: "monthly",
  dayCount: "30/360",
  paymentTiming: 0,
  computeMethod: "Normal",
};

describe("expandSteppedPercentage", () => {
  it("compounds 3% step every 12 periods over 36 months", () => {
    const e: CashFlowEvent = {
      date: utc(2025, 1, 1),
      kind: "stepped_percentage",
      amount: money("1000"),
      count: 36,
      interval: "monthly",
      seriesOptions: { stepPercent: rate("0.03"), stepEvery: 12 },
    };
    const out = expandSteppedPercentage(e);
    expect(out.length).toBe(36);
    expect(out[0]?.amount?.toNumber()).toBeCloseTo(1000, 6);
    expect(out[12]?.amount?.toNumber()).toBeCloseTo(1030, 6);
    expect(out[24]?.amount?.toNumber()).toBeCloseTo(1060.9, 1);
  });
});

describe("expandSkipPattern", () => {
  it("emits N pay then M skip cycles, total of `count` payments", () => {
    const e: CashFlowEvent = {
      date: utc(2025, 1, 1),
      kind: "skip_pattern",
      amount: money("100"),
      count: 6,
      interval: "monthly",
      seriesOptions: { skipNPayMSkip: { pay: 2, skip: 1 } },
    };
    const out = expandSkipPattern(e);
    expect(out.length).toBe(6);
    // Pattern: pay (Jan 1, Feb 1) skip Mar pay (Apr 1, May 1) skip Jun
    // pay (Jul 1, Aug 1)
    const months = out.map((o) => o.date.getUTCMonth() + 1);
    expect(months).toEqual([1, 2, 4, 5, 7, 8]);
  });
});

describe("expandCalendarMonthSkip", () => {
  it("skips June and July (school district payroll convention)", () => {
    const e: CashFlowEvent = {
      date: utc(2025, 1, 1),
      kind: "calendar_month_skip",
      amount: money("500"),
      count: 12,
      interval: "monthly",
      seriesOptions: { skipMonths: [6, 7] },
    };
    const out = expandCalendarMonthSkip(e);
    expect(out.length).toBe(10); // 12 months minus June and July
    const months = out.map((o) => o.date.getUTCMonth() + 1);
    expect(months).not.toContain(6);
    expect(months).not.toContain(7);
  });
});

describe("fixed_principal in schedule", () => {
  it("each payment pays a fixed principal + accrued interest; balance falls linearly", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("12000") },
      {
        date: utc(2025, 2, 1),
        kind: "fixed_principal",
        amount: money("1000"),
        count: 12,
        interval: "monthly",
      },
    ];
    const result = generateSchedule(events, masterMonthly);
    expect(result.endingBalance.toFixed(2)).toBe("0.00");
    expect(result.totalPrincipal.toNumber()).toBeCloseTo(12000, 0);
    // Each fixed_principal row pays 1000 of principal.
    const fpRows = result.rows.filter((r) => r.kind === "fixed_principal");
    for (const r of fpRows) {
      expect(r.principalApplied.toFixed(2)).toBe("1000.00");
    }
  });

  it("expandFixedPrincipal emits N rows", () => {
    const out = expandFixedPrincipal({
      date: utc(2025, 1, 1),
      kind: "fixed_principal",
      amount: money("500"),
      count: 24,
      interval: "monthly",
    });
    expect(out.length).toBe(24);
  });
});

describe("ruleOf78Schedule", () => {
  it("front-loads interest: payment 1 > payment N", () => {
    const sched = ruleOf78Schedule(money("1000"), 12);
    expect(sched.length).toBe(12);
    expect(sched[0]!.interestPortion.gt(sched[11]!.interestPortion)).toBe(true);
  });

  it("interest portions sum to the total finance charge", () => {
    const sched = ruleOf78Schedule(money("780"), 12);
    const total = sched.reduce((acc, x) => acc + x.interestPortion.toNumber(), 0);
    expect(total).toBeCloseTo(780, 6);
  });

  it("12-month rule-of-78: payment 1 = 12/78 of total, payment 12 = 1/78", () => {
    const sched = ruleOf78Schedule(money("780"), 12);
    expect(sched[0]!.interestPortion.toNumber()).toBeCloseTo(780 * (12 / 78), 4);
    expect(sched[11]!.interestPortion.toNumber()).toBeCloseTo(780 * (1 / 78), 4);
  });
});

describe("annual + fiscal-year + range rollups", () => {
  function build(): ReturnType<typeof generateSchedule> {
    const events: CashFlowEvent[] = [
      { date: utc(2025, 1, 1), kind: "loan", amount: money("100000") },
      {
        date: utc(2025, 2, 1),
        kind: "interest_only",
        count: 36,
        interval: "monthly",
      },
    ];
    return generateSchedule(events, masterMonthly);
  }

  it("rollupByYear groups 37 monthly rows into 4 calendar-year buckets (loan Jan 2025 + 36 months)", () => {
    const r = rollupByYear(build());
    // Loan Jan 1 2025 → year 2025 starts. 36 monthly interest_only
    // rows starting Feb 2025 reach Jan 2028. So years: 2025/2026/2027/2028.
    expect(r.length).toBe(4);
    expect(r.map((x) => x.year)).toEqual([2025, 2026, 2027, 2028]);
    expect(r[1]!.totalInterest.toNumber()).toBeCloseTo(6000, 0);
  });

  it("rollupByFiscalYear with June year-end rolls July+ into the next FY", () => {
    const r = rollupByFiscalYear(build(), 6);
    // Loan Jan 1 2025 → FY 2025 (ends June 2025)
    // Months 7..12 2025 + 1..6 2026 → FY 2026
    // Months 7..12 2026 + 1..2 2027 → FY 2027
    expect(r.length).toBeGreaterThanOrEqual(3);
  });

  it("rollupByRange returns only rows in [from, to]", () => {
    const sched = build();
    const ranged = rollupByRange(sched, utc(2025, 6, 1), utc(2025, 12, 31));
    for (const row of ranged) {
      expect(row.date.getTime()).toBeGreaterThanOrEqual(utc(2025, 6, 1).getTime());
      expect(row.date.getTime()).toBeLessThanOrEqual(utc(2025, 12, 31).getTime());
    }
  });
});
