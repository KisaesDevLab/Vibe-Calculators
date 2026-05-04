import { z } from "zod";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 15 acceptance — "A trivial 'double the input' toy calculator
 * can be added in <50 LOC and shows up automatically in the UI
 * sidebar, REST API, and help system."
 *
 * This is the canonical demonstration that the framework keeps the
 * effort to add a new calculator small. It also serves as a smoke
 * test that compute()'s purity contract holds.
 */

const inputSchema = z.object({
  value: z.number().finite(),
});
const outputSchema = z.object({ doubled: z.number() });
type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const toyDouble: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "toy.double",
    name: "Double (toy)",
    description: "Returns 2 × value. Phase-15 framework demonstration; not a real tax calc.",
    taxYears: [2024, 2025],
    formReferences: [],
    requiredTables: [],
  },
  inputSchema,
  outputSchema,
  validateInputs(raw: unknown): ValidationResult<Input> {
    const parsed = inputSchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  },
  compute(input) {
    return { doubled: input.value * 2 };
  },
  narrate(input, output) {
    return `Input ${input.value} doubled to ${output.doubled}.`;
  },
};

registerCalculator(toyDouble);

export { toyDouble };
