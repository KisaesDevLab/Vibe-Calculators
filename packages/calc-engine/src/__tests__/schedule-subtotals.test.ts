import { describe, expect, it } from "vitest";
import { money, rate } from "../types.js";
import { generateSchedule } from "../cashflow-schedule.js";
import { computeSubtotals, fiscalYearOf, fiscalQuarterOf } from "../schedule-subtotals.js";
import type { CashFlowEvent, MasterCalculationSettings } from "../cashflow-events.js";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

const masterMonthly: MasterCalculationSettings = {
  rate: rate("0.06"),
  compounding: "monthly",
  dayCount: "30/360",
  paymentTiming: 0,
  computeMethod: "Normal",
};

describe("fiscalYearOf", () => {
  it("calendar year = December year-end", () => {
    expect(fiscalYearOf(utc(2024, 1, 1), 12)).toBe(2024);
    expect(fiscalYearOf(utc(2024, 12, 31), 12)).toBe(2024);
  });
  it("June year-end shifts H2 dates to next FY", () => {
    expect(fiscalYearOf(utc(2024, 1, 1), 6)).toBe(2024);
    expect(fiscalYearOf(utc(2024, 6, 30), 6)).toBe(2024);
    expect(fiscalYearOf(utc(2024, 7, 1), 6)).toBe(2025);
    expect(fiscalYearOf(utc(2024, 12, 31), 6)).toBe(2025);
  });
});

describe("fiscalQuarterOf", () => {
  it("calendar year quarters", () => {
    expect(fiscalQuarterOf(utc(2024, 1, 15), 12).quarter).toBe(1);
    expect(fiscalQuarterOf(utc(2024, 4, 1), 12).quarter).toBe(2);
    expect(fiscalQuarterOf(utc(2024, 7, 1), 12).quarter).toBe(3);
    expect(fiscalQuarterOf(utc(2024, 10, 1), 12).quarter).toBe(4);
  });
  it("June year-end quarters: Jul-Sep is Q1", () => {
    expect(fiscalQuarterOf(utc(2024, 7, 1), 6)).toEqual({ fiscalYear: 2025, quarter: 1 });
    expect(fiscalQuarterOf(utc(2024, 10, 1), 6)).toEqual({ fiscalYear: 2025, quarter: 2 });
    expect(fiscalQuarterOf(utc(2025, 1, 1), 6)).toEqual({ fiscalYear: 2025, quarter: 3 });
    expect(fiscalQuarterOf(utc(2025, 4, 1), 6)).toEqual({ fiscalYear: 2025, quarter: 4 });
  });
});

describe("computeSubtotals — annual cadence", () => {
  // 100k loan, 24 monthly payments straddling Dec 2024 → Dec 2026.
  const events: CashFlowEvent[] = [
    { date: utc(2024, 12, 1), kind: "loan", amount: money("100000") },
    {
      date: utc(2025, 1, 1),
      kind: "payment",
      amount: money("4432.06"),
      count: 24,
      interval: "monthly",
    },
  ];

  it("groups by calendar year (December year-end)", () => {
    const schedule = generateSchedule(events, masterMonthly);
    const subs = computeSubtotals(schedule, { fiscalYearEndMonth: 12, cadence: "annual" });
    // Loan at Dec 2024, 12 payments in 2025, 12 payments in 2026 = 3 fiscal-year groups.
    expect(subs.map((s) => s.label)).toEqual(["2024 Totals", "2025 Totals", "2026 Totals"]);
  });

  it("emits a grand total when requested", () => {
    const schedule = generateSchedule(events, masterMonthly);
    const subs = computeSubtotals(schedule, { fiscalYearEndMonth: 12, grandTotal: true });
    expect(subs[subs.length - 1]?.label).toBe("Grand Total");
    // Grand total interest matches schedule.totalInterest exactly.
    expect(subs[subs.length - 1]?.totalInterest.toFixed(2)).toBe(schedule.totalInterest.toFixed(2));
    expect(subs[subs.length - 1]?.totalPrincipal.toFixed(2)).toBe(
      schedule.totalPrincipal.toFixed(2),
    );
  });

  it("June year-end shifts boundaries", () => {
    const schedule = generateSchedule(events, masterMonthly);
    const subs = computeSubtotals(schedule, { fiscalYearEndMonth: 6, cadence: "annual" });
    // Dec 2024 loan: m=12, > 6 → FY 2025.
    // Jan 2025 → Jun 2025 payments: m≤6 → FY 2025.
    // Jul 2025 → Dec 2026 payments: m>6 → FY 2026 (Jul-Dec 2025) and FY 2026 includes Jan-Jun 2026 too.
    // Actually re-verify: Jan-Jun 2026 → m≤6 → FY 2026. Jul-Dec 2026 → FY 2027.
    const labels = subs.map((s) => s.label);
    expect(labels).toContain("2025 Totals");
    expect(labels).toContain("2026 Totals");
    expect(labels).toContain("2027 Totals");
  });
});

describe("computeSubtotals — quarterly cadence", () => {
  it("emits four labels per fiscal year", () => {
    const events: CashFlowEvent[] = [
      { date: utc(2024, 1, 1), kind: "loan", amount: money("12000") },
      {
        date: utc(2024, 2, 1),
        kind: "payment",
        amount: money("1000"),
        count: 12,
        interval: "monthly",
      },
    ];
    const schedule = generateSchedule(events, masterMonthly);
    const subs = computeSubtotals(schedule, {
      fiscalYearEndMonth: 12,
      cadence: "quarterly",
    });
    // Loan at Q1 2024; 12 payments span Feb 2024 → Jan 2025.
    // Q1 2024 (Jan-Mar) has loan + 2 pmts; Q2 (Apr-Jun) 3 pmts; Q3 3; Q4 3; Q1 2025 1 pmt.
    expect(subs.map((s) => s.label)).toEqual([
      "Q1 2024",
      "Q2 2024",
      "Q3 2024",
      "Q4 2024",
      "Q1 2025",
    ]);
  });
});
