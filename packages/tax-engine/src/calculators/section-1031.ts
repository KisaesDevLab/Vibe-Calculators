import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";

/**
 * Phase 19.2 — Like-kind exchange under IRC §1031.
 *
 * Post-TCJA (2018+): only real property held for productive use in
 * trade or business or for investment qualifies.
 *
 * Computation:
 *   Realized gain = FMV relinquished - adjusted basis relinquished
 *   Boot received = cash + non-like-kind property + net debt relief
 *   Recognized gain = min(realized gain, boot received)
 *   Substitute basis = old adjusted basis - boot received + boot given
 *                       + recognized gain - other adjustments
 *
 * Recapture flag: §1245/§1250 recapture continues to apply on the
 * recognized portion of the gain (the part recognized via boot).
 */

const inputSchema = z
  .object({
    /** Adjusted basis of the relinquished property. */
    adjustedBasisRelinquished: z.number().nonnegative().finite(),
    /** Fair market value of the relinquished property at exchange. */
    fmvRelinquished: z.number().nonnegative().finite(),
    /** FMV of the replacement property received. */
    fmvReplacement: z.number().nonnegative().finite(),
    /** Cash boot received by taxpayer. */
    cashBootReceived: z.number().nonnegative().finite().default(0),
    /** Cash boot given (paid) by taxpayer. */
    cashBootGiven: z.number().nonnegative().finite().default(0),
    /** Non-like-kind property received (FMV). */
    otherPropertyBoot: z.number().nonnegative().finite().default(0),
    /** Net debt relief (mortgage relinquished - mortgage assumed). */
    netDebtRelief: z.number().finite().default(0),
    /** Was the relinquished property §1245 (personal property — recapture risk)? */
    isSection1245: z.boolean().default(false),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  realizedGain: z.number(),
  bootReceived: z.number(),
  recognizedGain: z.number(),
  deferredGain: z.number(),
  substituteBasisReplacement: z.number(),
  recaptureFlag: z.boolean(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const section1031: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.section_1031",
    name: "§1031 like-kind exchange",
    description:
      "Like-kind exchange of real property: realized vs. recognized gain, boot, substitute basis, depreciation-recapture flag. Post-TCJA real-property only.",
    taxYears: [2024, 2025],
    formReferences: ["Form 8824", "Pub 544"],
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
    const realized = new Decimal(input.fmvRelinquished).minus(input.adjustedBasisRelinquished);
    // Reg §1.1031(d)-2 example 2: cash boot given OFFSETS cash boot
    // received before computing recognized gain. Net debt relief is
    // capped at zero on the receive side; net debt assumed (negative
    // input.netDebtRelief) flows into boot given.
    const debtRelief = Decimal.max(0, input.netDebtRelief);
    const debtAssumed = Decimal.max(0, new Decimal(-input.netDebtRelief));
    const grossBootReceived = new Decimal(input.cashBootReceived)
      .plus(input.otherPropertyBoot)
      .plus(debtRelief);
    const grossBootGiven = new Decimal(input.cashBootGiven).plus(debtAssumed);
    // Net cash boot — only the unilateral overage triggers gain.
    const netBootReceived = Decimal.max(0, grossBootReceived.minus(grossBootGiven));
    const recognized = Decimal.max(0, Decimal.min(realized, netBootReceived));
    const deferred = realized.minus(recognized);
    // Echo the gross boot in the response so the caller can audit.
    const bootReceived = grossBootReceived;

    // Substitute basis: old basis - gross boot received + gross boot
    // given + recognized gain (Reg §1.1031(d)-1).
    const substituteBasis = new Decimal(input.adjustedBasisRelinquished)
      .minus(grossBootReceived)
      .plus(grossBootGiven)
      .plus(recognized);

    const recaptureFlag = input.isSection1245 && recognized.gt(0);

    const notes: string[] = [];
    if (recognized.gt(0)) {
      notes.push(
        `Recognized gain $${recognized.toDecimalPlaces(2).toString()} = min(realized $${realized.toDecimalPlaces(2).toString()}, boot received $${bootReceived.toDecimalPlaces(2).toString()}).`,
      );
    } else {
      notes.push("No recognized gain — full deferral.");
    }
    if (recaptureFlag) {
      notes.push(
        "§1245 recapture risk: recognized gain may be ordinary up to prior depreciation; consult depreciation schedule.",
      );
    }
    if (input.netDebtRelief < 0) {
      notes.push(
        "Net debt assumed (negative debt relief) is treated as boot given — included in substitute basis.",
      );
    }

    return {
      realizedGain: realized.toDecimalPlaces(2).toNumber(),
      bootReceived: bootReceived.toDecimalPlaces(2).toNumber(),
      recognizedGain: recognized.toDecimalPlaces(2).toNumber(),
      deferredGain: deferred.toDecimalPlaces(2).toNumber(),
      substituteBasisReplacement: substituteBasis.toDecimalPlaces(2).toNumber(),
      recaptureFlag,
      notes,
    };
  },
  narrate(input, output) {
    return (
      `§1031 exchange: realized $${output.realizedGain.toLocaleString("en-US")}, ` +
      `recognized $${output.recognizedGain.toLocaleString("en-US")}, ` +
      `deferred $${output.deferredGain.toLocaleString("en-US")}. ` +
      `Substitute basis in replacement: $${output.substituteBasisReplacement.toLocaleString("en-US")}.`
    );
  },
};

registerCalculator(section1031);

export { section1031 };
