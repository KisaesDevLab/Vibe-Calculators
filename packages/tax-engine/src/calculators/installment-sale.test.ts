import { describe, expect, it } from "vitest";
import { installmentSale } from "./installment-sale.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("§453 installment sale", () => {
  it("$200k sale, $100k basis, no expenses → GPR 50%, gain spread over payments", () => {
    const out = installmentSale.compute(
      {
        salePrice: 200_000,
        adjustedBasis: 100_000,
        sellingExpenses: 0,
        depreciationRecapture: 0,
        payments: [
          { year: 2024, principal: 100_000, interest: 5_000 },
          { year: 2025, principal: 100_000, interest: 2_500 },
        ],
      },
      ctx,
    );
    expect(out.grossProfit).toBe(100_000);
    expect(out.grossProfitRatio).toBe(0.5);
    expect(out.schedule[0]?.gainRecognized).toBe(50_000);
    expect(out.schedule[1]?.gainRecognized).toBe(50_000);
    expect(out.totalGainOverLife).toBe(100_000);
  });

  it("Selling expenses reduce gross profit", () => {
    const out = installmentSale.compute(
      {
        salePrice: 200_000,
        adjustedBasis: 100_000,
        sellingExpenses: 20_000,
        depreciationRecapture: 0,
        payments: [{ year: 2024, principal: 200_000, interest: 0 }],
      },
      ctx,
    );
    expect(out.grossProfit).toBe(80_000);
    expect(out.grossProfitRatio).toBe(0.4);
    expect(out.schedule[0]?.gainRecognized).toBe(80_000);
  });

  it("Recapture is recognized in year of sale, regardless of payment schedule", () => {
    const out = installmentSale.compute(
      {
        salePrice: 200_000,
        adjustedBasis: 100_000,
        sellingExpenses: 0,
        depreciationRecapture: 30_000,
        payments: [
          { year: 2024, principal: 50_000, interest: 0 },
          { year: 2025, principal: 150_000, interest: 0 },
        ],
      },
      ctx,
    );
    expect(out.schedule[0]?.ordinaryRecapture).toBe(30_000);
    expect(out.schedule[1]?.ordinaryRecapture).toBe(0);
  });
});
