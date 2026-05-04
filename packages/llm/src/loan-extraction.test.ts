import { describe, expect, it } from "vitest";
import {
  extractLoanAgreement,
  flagLowConfidenceFields,
  loanExtractionSchema,
} from "./loan-extraction.js";
import type { LlmProvider, LlmTextRequest, LlmTextResponse } from "./types.js";

class StubProvider implements LlmProvider {
  readonly name = "stub";
  constructor(private readonly emitted: object) {}
  lastRequest?: LlmTextRequest;
  async generate(request: LlmTextRequest): Promise<LlmTextResponse> {
    this.lastRequest = request;
    return {
      text: JSON.stringify(this.emitted),
      responseId: "stub-1",
      model: "stub-model",
      inputTokens: 100,
      outputTokens: 50,
      provider: this.name,
    };
  }
}

const VALID_EXTRACTION = {
  borrower: { name: "Acme LLC", address: "123 Main St" },
  lender: { name: "First Bank", address: null },
  principal: 250_000,
  interestRate: 0.075,
  compounding: "monthly",
  termMonths: 360,
  firstPaymentDate: "2025-07-01",
  paymentFrequency: "monthly",
  paymentAmount: 1748.04,
  prepaymentPenalty: false,
  lateFeeNote: null,
  variableRateClause: null,
  notes: null,
  fieldConfidence: { paymentAmount: 0.6 },
};

describe("loan extraction", () => {
  it("parses a well-formed structured response", async () => {
    const provider = new StubProvider(VALID_EXTRACTION);
    const out = await extractLoanAgreement(provider, "raw doc text…");
    expect(out.extraction.principal).toBe(250_000);
    expect(out.extraction.interestRate).toBe(0.075);
    expect(out.extraction.borrower.name).toBe("Acme LLC");
    expect(out.tokens.input).toBe(100);
    expect(out.responseId).toBe("stub-1");
  });

  it("forces tool-use shape via responseSchema in the request", async () => {
    const provider = new StubProvider(VALID_EXTRACTION);
    await extractLoanAgreement(provider, "doc");
    expect(provider.lastRequest?.responseSchema).toBeDefined();
    expect(provider.lastRequest?.system).toContain("CPA firm");
  });

  it("rejects malformed responses (zod validation)", async () => {
    const provider = new StubProvider({ wrong: "shape" });
    await expect(extractLoanAgreement(provider, "doc")).rejects.toThrow();
  });

  it("flagLowConfidenceFields surfaces values below threshold", () => {
    const sample = loanExtractionSchema.parse(VALID_EXTRACTION);
    expect(flagLowConfidenceFields(sample, 0.7)).toEqual(["paymentAmount"]);
    expect(flagLowConfidenceFields(sample, 0.5)).toEqual([]);
  });
});
