import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addHalfMonths,
  addPeriods,
  isLeapYear,
  nextBusinessDay,
  snapToHalfMonth,
} from "../date-arithmetic.js";
import {
  isCompatibleSubInterval,
  periodLengthDays,
  periodsPerYear,
  type CompoundingInterval,
} from "../compounding.js";

const DISCRETE_INTERVALS: CompoundingInterval[] = [
  "daily",
  "weekly",
  "biweekly",
  "half-month",
  "four-week",
  "monthly",
  "bi-monthly",
  "quarterly",
  "semi-annual",
  "annual",
];

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

describe("compounding intervals", () => {
  it("periodsPerYear values match the build-plan §5.5 list", () => {
    expect(periodsPerYear("daily")).toBe(365);
    expect(periodsPerYear("weekly")).toBe(52);
    expect(periodsPerYear("biweekly")).toBe(26);
    expect(periodsPerYear("half-month")).toBe(24);
    expect(periodsPerYear("four-week")).toBe(13);
    expect(periodsPerYear("monthly")).toBe(12);
    expect(periodsPerYear("bi-monthly")).toBe(6);
    expect(periodsPerYear("quarterly")).toBe(4);
    expect(periodsPerYear("semi-annual")).toBe(2);
    expect(periodsPerYear("annual")).toBe(1);
    expect(periodsPerYear("continuous")).toBeNull();
    expect(periodsPerYear("exact-days")).toBeNull();
  });

  it("periodLengthDays * periodsPerYear ≈ 365 for fixed-period intervals", () => {
    for (const iv of DISCRETE_INTERVALS) {
      const p = periodsPerYear(iv)!;
      const len = periodLengthDays(iv)!;
      const total = len.times(p).toNumber();
      // weekly/biweekly/four-week use fixed day counts (7/14/28) so
      // their year sum is 364; other intervals tile 365 exactly.
      expect([364, 365]).toContain(total);
    }
  });

  it("isCompatibleSubInterval: master=quarterly, sub=monthly is TRUE (12%4==0)", () => {
    expect(isCompatibleSubInterval("quarterly", "monthly")).toBe(true);
  });

  it("isCompatibleSubInterval: master=monthly, sub=quarterly is FALSE (4%12!=0)", () => {
    expect(isCompatibleSubInterval("monthly", "quarterly")).toBe(false);
  });

  it("isCompatibleSubInterval: master=monthly, sub=weekly is FALSE (52%12!=0)", () => {
    expect(isCompatibleSubInterval("monthly", "weekly")).toBe(false);
  });

  it("isCompatibleSubInterval: continuous master accepts anything", () => {
    expect(isCompatibleSubInterval("continuous", "monthly")).toBe(true);
    expect(isCompatibleSubInterval("monthly", "continuous")).toBe(true);
  });
});

describe("addPeriods", () => {
  it("count=0 returns the input date", () => {
    const d = utc(2025, 6, 15);
    for (const iv of DISCRETE_INTERVALS) {
      expect(addPeriods(d, 0, iv).getTime()).toBe(d.getTime());
    }
  });

  it("monthly addition is monotonic", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1) }),
        fc.integer({ min: -240, max: 240 }),
        (d, n) => {
          const r1 = addPeriods(d, n, "monthly");
          const r2 = addPeriods(d, n + 1, "monthly");
          expect(r2.getTime()).toBeGreaterThan(r1.getTime());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("annual + 1 year ≈ 365 or 366 actual days", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date(2000, 0, 2), max: new Date(2100, 0, 1) }), (d) => {
        const next = addPeriods(d, 1, "annual");
        const days = (next.getTime() - d.getTime()) / (24 * 3600 * 1000);
        expect(days === 365 || days === 366).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("addPeriods('continuous') throws", () => {
    expect(() => addPeriods(utc(2025, 1, 1), 1, "continuous")).toThrow();
  });
});

describe("half-month addition", () => {
  it("snapToHalfMonth lands on the 15th or end-of-month", () => {
    expect(snapToHalfMonth(utc(2025, 6, 1)).getUTCDate()).toBe(15);
    expect(snapToHalfMonth(utc(2025, 6, 15)).getUTCDate()).toBe(15);
    expect(snapToHalfMonth(utc(2025, 6, 20)).getUTCDate()).toBe(30);
    expect(snapToHalfMonth(utc(2025, 2, 16)).getUTCDate()).toBe(28);
  });

  it("addHalfMonths(15th, 1) = end-of-same-month", () => {
    expect(addHalfMonths(utc(2025, 1, 15), 1).getUTCDate()).toBe(31);
    expect(addHalfMonths(utc(2025, 2, 15), 1).getUTCDate()).toBe(28);
    expect(addHalfMonths(utc(2024, 2, 15), 1).getUTCDate()).toBe(29);
  });

  it("addHalfMonths(EOM, 1) = 15th of next month", () => {
    expect(addHalfMonths(utc(2025, 1, 31), 1).getUTCDate()).toBe(15);
    expect(addHalfMonths(utc(2025, 1, 31), 1).getUTCMonth()).toBe(1); // Feb (0-indexed)
  });

  it("addHalfMonths(15th, 2) = 15th of next month", () => {
    const r = addHalfMonths(utc(2025, 1, 15), 2);
    expect(r.getUTCDate()).toBe(15);
    expect(r.getUTCMonth()).toBe(1);
  });

  it("24 half-months = 1 year (12 forward, exact)", () => {
    const start = utc(2025, 6, 15);
    const end = addHalfMonths(start, 24);
    expect(end.getUTCFullYear()).toBe(2026);
    expect(end.getUTCMonth()).toBe(5); // June
    expect(end.getUTCDate()).toBe(15);
  });
});

describe("isLeapYear", () => {
  it("2024 leap, 2025 not, 2100 not, 2000 leap", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe("nextBusinessDay", () => {
  it("Saturday → Monday", () => {
    // 2025-06-07 is Saturday
    expect(nextBusinessDay(utc(2025, 6, 7)).getUTCDate()).toBe(9);
  });

  it("Sunday → Monday", () => {
    expect(nextBusinessDay(utc(2025, 6, 8)).getUTCDate()).toBe(9);
  });

  it("Weekday is a no-op", () => {
    expect(nextBusinessDay(utc(2025, 6, 11)).getUTCDate()).toBe(11);
  });
});
