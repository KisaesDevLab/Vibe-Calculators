import { describe, expect, it } from "vitest";
import { irsInterest } from "./irs-interest.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("IRS interest + FTF/FTP penalties", () => {
  it("$10k underpayment paid 90 days late at 8% → daily-compounded interest ≈ $200", () => {
    const out = irsInterest.compute(
      {
        taxBalanceOwed: 10_000,
        returnDueDate: "2024-04-15",
        paymentDate: "2024-07-14",
        returnFiledOnTime: true,
        levyNoticeIssued: false,
        installmentAgreementOnFile: false,
      },
      ctx,
    );
    expect(out.daysLate).toBe(90);
    // 10,000 × ((1 + 0.08/365)^90 - 1) ≈ 199.20
    expect(out.underpaymentInterest).toBeCloseTo(199.2, 1);
  });

  it("FTP for 3 months @ 0.5%: $10k × 1.5% = $150", () => {
    const out = irsInterest.compute(
      {
        taxBalanceOwed: 10_000,
        returnDueDate: "2024-04-15",
        paymentDate: "2024-07-14",
        returnFiledOnTime: true,
        levyNoticeIssued: false,
        installmentAgreementOnFile: false,
      },
      ctx,
    );
    // 90 days = 3 months → 1.5%
    expect(out.failureToPayPenalty).toBe(150);
  });

  it("Installment agreement reduces FTP to 0.25%/month", () => {
    const out = irsInterest.compute(
      {
        taxBalanceOwed: 10_000,
        returnDueDate: "2024-04-15",
        paymentDate: "2024-07-14",
        returnFiledOnTime: true,
        levyNoticeIssued: false,
        installmentAgreementOnFile: true,
      },
      ctx,
    );
    expect(out.failureToPayPenalty).toBe(75); // 0.25% × 3 months × 10,000
  });

  it("FTF stacks: late filing 5 months adds substantial penalty", () => {
    const out = irsInterest.compute(
      {
        taxBalanceOwed: 10_000,
        returnDueDate: "2024-04-15",
        paymentDate: "2024-09-15",
        returnFiledOnTime: false,
        actualFilingDate: "2024-09-15",
        levyNoticeIssued: false,
        installmentAgreementOnFile: false,
      },
      ctx,
    );
    // FTF capped at 22.5% net of FTP overlap; 5 months × 4.5% = 22.5%
    expect(out.failureToFilePenalty).toBeGreaterThan(2_000);
    expect(out.failureToFilePenalty).toBeLessThanOrEqual(2_250);
  });

  it("FTP cap at 25% (50 months)", () => {
    const out = irsInterest.compute(
      {
        taxBalanceOwed: 10_000,
        returnDueDate: "2020-04-15",
        paymentDate: "2025-04-15",
        returnFiledOnTime: true,
        levyNoticeIssued: false,
        installmentAgreementOnFile: false,
      },
      ctx,
    );
    expect(out.failureToPayPenalty).toBeCloseTo(2_500, 0); // 25% × 10,000
  });
});
