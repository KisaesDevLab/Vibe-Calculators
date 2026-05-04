import { z } from "zod";
import type { LlmProvider } from "./types.js";

/**
 * Phase 23.3 — loan-agreement extraction prompt + Zod schema.
 *
 * The schema is the contract the rest of the appliance treats as
 * authoritative; the prompt steers the LLM to fill it. We force
 * tool-use shaping so the model emits a single structured JSON
 * object rather than free-form prose.
 *
 * Confidence scoring: each field has an optional `_confidence`
 * sibling (0..1). The review endpoint flags anything < 0.7 for
 * human review (Phase 23.7).
 */

export const loanExtractionSchema = z.object({
  borrower: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
  }),
  lender: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
  }),
  /** Principal amount in dollars. */
  principal: z.number().nullable(),
  /** Interest rate as decimal (0.075 = 7.5%). */
  interestRate: z.number().nullable(),
  /** Compounding frequency string (annually, monthly, etc.). */
  compounding: z.string().nullable(),
  /** Term in months. */
  termMonths: z.number().int().nullable(),
  /** First payment due date (YYYY-MM-DD). */
  firstPaymentDate: z.string().nullable(),
  paymentFrequency: z.string().nullable(),
  /** Periodic payment amount (if specified explicitly in the doc). */
  paymentAmount: z.number().nullable(),
  /** Pre-payment penalty present? */
  prepaymentPenalty: z.boolean().nullable(),
  /** Late-payment fee schedule, if any. */
  lateFeeNote: z.string().nullable(),
  /** Variable-rate note: index + spread. */
  variableRateClause: z.string().nullable(),
  /** Free-form notes the model thought were relevant. */
  notes: z.string().nullable(),
  /** Per-field confidence 0..1 (sparse — only populated where uncertain). */
  fieldConfidence: z.record(z.number().min(0).max(1)).default({}),
});

export type LoanExtraction = z.infer<typeof loanExtractionSchema>;

const SYSTEM_PROMPT = `You are an extraction system for a CPA firm. You read loan-agreement documents and emit a strictly-typed JSON object with the agreement's key terms. Use null for any field the document does not state explicitly. Do not infer values that aren't in the text. Always invoke the emit_structured_response tool.`;

const USER_TEMPLATE = (text: string): string =>
  `Extract the loan-agreement terms from the document below. If a field is ambiguous, set it to null and add a note in the "notes" field. For any field with reduced confidence (parsing was difficult, doc was unclear), record that field's confidence in "fieldConfidence" with a value 0..1.\n\n--- DOCUMENT ---\n${text}\n--- END DOCUMENT ---`;

/**
 * Run the extraction prompt against the provided LLM provider and
 * return the parsed result. Throws on schema mismatch.
 */
export async function extractLoanAgreement(
  provider: LlmProvider,
  documentText: string,
): Promise<{
  extraction: LoanExtraction;
  tokens: { input: number; output: number };
  responseId: string;
}> {
  const response = await provider.generate({
    prompt: USER_TEMPLATE(documentText),
    system: SYSTEM_PROMPT,
    maxTokens: 4096,
    temperature: 0,
    responseSchema: schemaToJsonSchema(),
  });
  const parsed = JSON.parse(response.text) as unknown;
  const validated = loanExtractionSchema.parse(parsed);
  return {
    extraction: validated,
    tokens: { input: response.inputTokens, output: response.outputTokens },
    responseId: response.responseId,
  };
}

/**
 * Hand-written JSON Schema corresponding to `loanExtractionSchema`.
 * We don't depend on a runtime zod-to-json-schema converter because
 * the Anthropic tool-use input_schema must be JSON Schema 2020-12
 * with a small, predictable shape.
 */
function schemaToJsonSchema(): Record<string, unknown> {
  const partyShape = {
    type: "object",
    properties: {
      name: { type: ["string", "null"] },
      address: { type: ["string", "null"] },
    },
    required: ["name", "address"],
    additionalProperties: false,
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      borrower: partyShape,
      lender: partyShape,
      principal: { type: ["number", "null"] },
      interestRate: { type: ["number", "null"] },
      compounding: { type: ["string", "null"] },
      termMonths: { type: ["integer", "null"] },
      firstPaymentDate: { type: ["string", "null"] },
      paymentFrequency: { type: ["string", "null"] },
      paymentAmount: { type: ["number", "null"] },
      prepaymentPenalty: { type: ["boolean", "null"] },
      lateFeeNote: { type: ["string", "null"] },
      variableRateClause: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      fieldConfidence: {
        type: "object",
        additionalProperties: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    required: [
      "borrower",
      "lender",
      "principal",
      "interestRate",
      "compounding",
      "termMonths",
      "firstPaymentDate",
      "paymentFrequency",
      "paymentAmount",
      "prepaymentPenalty",
      "lateFeeNote",
      "variableRateClause",
      "notes",
      "fieldConfidence",
    ],
  };
}

/**
 * Phase 23.7 — flag fields below the confidence threshold for
 * human-in-the-loop review.
 */
export function flagLowConfidenceFields(extraction: LoanExtraction, threshold = 0.7): string[] {
  return Object.entries(extraction.fieldConfidence)
    .filter(([, score]) => score < threshold)
    .map(([key]) => key);
}
