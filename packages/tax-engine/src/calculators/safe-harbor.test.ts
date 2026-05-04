import { describe, expect, it } from "vitest";
import { safeHarbor } from "./safe-harbor.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("Federal estimated-tax safe harbor", () => {
  it("Prior AGI $100k, 100% prior-year rule applies (under $150k threshold)", () => {
    const out = safeHarbor.compute(
      {
        currentYearProjectedTax: 50_000,
        priorYearTax: 30_000,
        priorYearAgi: 100_000,
        withholdingTotal: 0,
        filingStatus: "single",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.hundredTenApplies).toBe(false);
    expect(out.hundredOrTenPctRule).toBe(30_000);
    // 90% × 50k = 45k vs. 100% × 30k = 30k → bind 30k
    expect(out.requiredAnnualPayment).toBe(30_000);
    expect(out.perQuarterAmount).toBe(7_500);
  });

  it("Prior AGI $200k, 110% rule applies", () => {
    const out = safeHarbor.compute(
      {
        currentYearProjectedTax: 60_000,
        priorYearTax: 50_000,
        priorYearAgi: 200_000,
        withholdingTotal: 10_000,
        filingStatus: "single",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.hundredTenApplies).toBe(true);
    expect(out.hundredOrTenPctRule).toBe(55_000);
    // 90% × 60k = 54k vs. 110% × 50k = 55k → bind 54k
    expect(out.requiredAnnualPayment).toBe(54_000);
    expect(out.remainingAfterWithholding).toBe(44_000);
    expect(out.perQuarterAmount).toBe(11_000);
  });

  it("MFS uses $75k threshold for the 110% rule", () => {
    const out = safeHarbor.compute(
      {
        currentYearProjectedTax: 30_000,
        priorYearTax: 20_000,
        priorYearAgi: 100_000,
        withholdingTotal: 0,
        filingStatus: "mfs",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.hundredTenApplies).toBe(true);
    expect(out.hundredOrTenPctRule).toBe(22_000);
  });

  it("Quarterly due dates use the statutory schedule (4/15, 6/15, 9/15, 1/15+1)", () => {
    const out = safeHarbor.compute(
      {
        currentYearProjectedTax: 4_000,
        priorYearTax: 4_000,
        priorYearAgi: 50_000,
        withholdingTotal: 0,
        filingStatus: "single",
        taxYear: 2025,
      },
      ctx,
    );
    expect(out.quarterly[0]?.dueDate).toBe("2025-04-15");
    expect(out.quarterly[1]?.dueDate).toBe("2025-06-15");
    expect(out.quarterly[2]?.dueDate).toBe("2025-09-15");
    expect(out.quarterly[3]?.dueDate).toBe("2026-01-15");
  });
});
