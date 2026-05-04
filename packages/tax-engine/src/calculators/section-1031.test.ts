import { describe, expect, it } from "vitest";
import { section1031 } from "./section-1031.js";

const ctx = { tables: new Map(), asOf: new Date() };

describe("§1031 like-kind exchange", () => {
  it("Pure swap (no boot): full deferral, basis carries over", () => {
    const out = section1031.compute(
      {
        adjustedBasisRelinquished: 100_000,
        fmvRelinquished: 250_000,
        fmvReplacement: 250_000,
        cashBootReceived: 0,
        cashBootGiven: 0,
        otherPropertyBoot: 0,
        netDebtRelief: 0,
        isSection1245: false,
      },
      ctx,
    );
    expect(out.realizedGain).toBe(150_000);
    expect(out.recognizedGain).toBe(0);
    expect(out.deferredGain).toBe(150_000);
    expect(out.substituteBasisReplacement).toBe(100_000);
  });

  it("Cash boot received recognizes gain up to boot", () => {
    const out = section1031.compute(
      {
        adjustedBasisRelinquished: 100_000,
        fmvRelinquished: 250_000,
        fmvReplacement: 200_000,
        cashBootReceived: 50_000,
        cashBootGiven: 0,
        otherPropertyBoot: 0,
        netDebtRelief: 0,
        isSection1245: false,
      },
      ctx,
    );
    expect(out.recognizedGain).toBe(50_000);
    expect(out.deferredGain).toBe(100_000);
    // Substitute basis = 100k - 50k boot received + 50k recognized = 100k
    expect(out.substituteBasisReplacement).toBe(100_000);
  });

  it("§1245 + recognized gain → recapture flag set", () => {
    const out = section1031.compute(
      {
        adjustedBasisRelinquished: 50_000,
        fmvRelinquished: 200_000,
        fmvReplacement: 150_000,
        cashBootReceived: 50_000,
        cashBootGiven: 0,
        otherPropertyBoot: 0,
        netDebtRelief: 0,
        isSection1245: true,
      },
      ctx,
    );
    expect(out.recaptureFlag).toBe(true);
    expect(out.notes.some((n) => n.includes("recapture"))).toBe(true);
  });
});
