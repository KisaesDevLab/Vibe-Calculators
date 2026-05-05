import { describe, expect, it } from "vitest";
import {
  extractLoanAgreement,
  flagLowConfidenceFields,
  loanExtractionSchema,
} from "../loan-extraction.js";
import type { LlmProvider, LlmTextRequest, LlmTextResponse } from "../types.js";
import { LOAN_FIXTURES } from "./loan-fixtures.js";

/**
 * Phase 23.18 — extraction regression suite.
 *
 * Each fixture's `expected` object is replayed by a MockProvider so
 * we exercise the full prompt → JSON → Zod path without making real
 * LLM calls. The asserts cover:
 *   1. Zod parse succeeds (proves the schema can represent the
 *      shape; if a future schema change drops or renames a field
 *      every fixture covering that field starts failing).
 *   2. Round-tripped extraction is byte-for-byte equal to the
 *      `expected` (proves the prompt template + extraction wrapper
 *      didn't silently mutate the payload).
 *   3. Low-confidence flagger picks up everything below 0.7.
 *
 * Adding a fixture: write a synthetic excerpt + expected object,
 * append to LOAN_FIXTURES — that's it. No prompt change needed.
 */

class MockProvider implements LlmProvider {
  readonly name = "mock";
  constructor(private readonly emit: object) {}
  async generate(_request: LlmTextRequest): Promise<LlmTextResponse> {
    return {
      text: JSON.stringify(this.emit),
      responseId: `mock-${Math.random().toString(36).slice(2, 8)}`,
      model: "mock-fixture",
      inputTokens: 1234,
      outputTokens: 567,
      provider: this.name,
    };
  }
}

describe("loan extraction regression fixtures (Phase 23.18)", () => {
  it("ships exactly 15 fixtures (build plan target)", () => {
    expect(LOAN_FIXTURES.length).toBe(15);
  });

  for (const fx of LOAN_FIXTURES) {
    it(`[${fx.id}] ${fx.description}`, async () => {
      // Sanity: the expected object must already validate against the schema.
      // If this fails, the fixture itself is wrong.
      const expectedParsed = loanExtractionSchema.parse(fx.expected);
      expect(expectedParsed).toEqual(fx.expected);

      const provider = new MockProvider(fx.expected);
      const out = await extractLoanAgreement(provider, fx.document);

      // Byte-for-byte parity with the fixture's expected payload.
      expect(out.extraction).toEqual(fx.expected);

      // Token bookkeeping flows from provider → caller.
      expect(out.tokens.input).toBe(1234);
      expect(out.tokens.output).toBe(567);

      // Low-confidence flagger sees everything < 0.7 in the fixture.
      const flagged = flagLowConfidenceFields(out.extraction, 0.7);
      const expectedFlagged = Object.entries(fx.expected.fieldConfidence)
        .filter(([, v]) => v < 0.7)
        .map(([k]) => k)
        .sort();
      expect([...flagged].sort()).toEqual(expectedFlagged);
    });
  }
});
