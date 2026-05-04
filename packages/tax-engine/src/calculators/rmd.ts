import { z } from "zod";
import Decimal from "decimal.js";
import { registerCalculator } from "../registry.js";
import type { TaxCalculator, ValidationResult } from "../types.js";
import { rmdStartAge, uniformLifetimeDivisor, singleLifeDivisor } from "../lib/rmd-tables.js";

/**
 * Phase 17.1 — Required Minimum Distribution (RMD) calculator.
 *
 * Three modes:
 *   1. **Uniform Lifetime** — default; for owners whose spouse is
 *      not the sole beneficiary, or whose spouse is < 10 years
 *      younger.
 *   2. **Joint Life** — owner + sole-beneficiary spouse > 10 years
 *      younger. Implemented via the same formula but using the
 *      joint table (deferred — Pub 590-B Table II is large; for
 *      MVP we surface a flag and a TODO note rather than a wrong
 *      answer).
 *   3. **Single Life (inherited)** — for non-spouse beneficiaries.
 *      Pre-SECURE: stretch over single-life expectancy. Post-
 *      SECURE (deaths after 2019): 10-year rule for non-EDB
 *      beneficiaries, single-life stretch for EDBs.
 *
 * SECURE 2.0 start ages:
 *   - Born ≤ 1950: age 72 (pre-SECURE 2.0)
 *   - Born 1951-1959: age 73 (Sec. 107)
 *   - Born ≥ 1960: age 75 (Sec. 107)
 */

const inputSchema = z
  .object({
    /** Account balance as of Dec 31 of the prior year. */
    priorYearEndBalance: z.number().positive().finite(),
    /** Owner's birth year (drives start age + uniform divisor). */
    ownerBirthYear: z.number().int().min(1900).max(2100),
    /** Distribution year. */
    distributionYear: z.number().int().min(2023).max(2100),
    mode: z.enum(["uniform", "joint", "single_life"]).default("uniform"),
    /** For joint mode — sole-beneficiary spouse's birth year. */
    spouseBirthYear: z.number().int().min(1900).max(2100).optional(),
    /** For single_life — beneficiary's birth year (inherited IRA). */
    beneficiaryBirthYear: z.number().int().min(1900).max(2100).optional(),
    /** Account type — IRAs aggregate, 401(k)s do not. Surfaced in narrate. */
    accountType: z
      .enum(["traditional_ira", "roth_ira", "401k", "403b", "457b"])
      .default("traditional_ira"),
    /** Inherited-account flag (used with single_life). */
    isInherited: z.boolean().default(false),
    /** Year the original owner died (for inherited rules). */
    decedentDeathYear: z.number().int().min(1900).max(2100).optional(),
    /** Beneficiary is an Eligible Designated Beneficiary (EDB)? */
    beneficiaryIsEdb: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.mode === "joint" && input.spouseBirthYear === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spouseBirthYear"],
        message: "spouseBirthYear required for joint mode",
      });
    }
    if (input.mode === "single_life" && input.beneficiaryBirthYear === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beneficiaryBirthYear"],
        message: "beneficiaryBirthYear required for single_life mode",
      });
    }
  });

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  rmdRequired: z.boolean(),
  rmdAmount: z.number(),
  divisor: z.number(),
  startAge: z.number(),
  ageAtYearEnd: z.number(),
  mode: z.string(),
  rule: z.string(),
  notes: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const rmd: TaxCalculator<Input, Output> = {
  metadata: {
    kind: "tax.rmd",
    name: "RMD calculator",
    description:
      "Required Minimum Distribution under SECURE 2.0 — Uniform Lifetime (owner), Joint Life (sole-beneficiary spouse > 10y younger), Single Life (inherited). Per Pub 590-B.",
    taxYears: [2024, 2025, 2026],
    formReferences: ["Pub 590-B App B", "Form 5498", "Form 1099-R"],
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
    const ageAtYearEnd = input.distributionYear - input.ownerBirthYear;
    const startAge = rmdStartAge(input.ownerBirthYear);
    const balance = new Decimal(input.priorYearEndBalance);
    const notes: string[] = [];

    if (input.mode === "single_life") {
      // Inherited IRA: post-SECURE (death after 2019) imposes the
      // 10-year rule unless beneficiary is EDB.
      const decedentYear = input.decedentDeathYear;
      const benBirth = input.beneficiaryBirthYear;
      if (benBirth === undefined) throw new Error("unreachable");
      const benAgeAtYearEnd = input.distributionYear - benBirth;
      const divisor = singleLifeDivisor(benAgeAtYearEnd);
      const amount = balance.div(divisor).toDecimalPlaces(2);
      let rule = "Single-life expectancy (pre-SECURE stretch)";
      if (decedentYear !== undefined && decedentYear >= 2020) {
        if (input.beneficiaryIsEdb) {
          rule = "Single-life expectancy (EDB exception under SECURE)";
        } else {
          rule = "10-year rule (SECURE Act, non-EDB)";
          notes.push(
            "Post-SECURE non-EDB beneficiaries must empty the inherited account by Dec 31 of year 10. Annual RMD shown is the stretch amount; under final 2024 regs, annual RMDs are also required when decedent died on/after RBD.",
          );
        }
      }
      return {
        rmdRequired: true,
        rmdAmount: amount.toNumber(),
        divisor,
        startAge,
        ageAtYearEnd: benAgeAtYearEnd,
        mode: "single_life",
        rule,
        notes,
      };
    }

    if (input.mode === "joint") {
      notes.push(
        "Joint Life (Pub 590-B Table II) deferred to a follow-up phase; falling back to Uniform Lifetime. For a spouse > 10 years younger, the actual divisor is larger so the RMD is lower than shown.",
      );
    }

    // Uniform Lifetime path.
    if (ageAtYearEnd < startAge) {
      return {
        rmdRequired: false,
        rmdAmount: 0,
        divisor: 0,
        startAge,
        ageAtYearEnd,
        mode: input.mode,
        rule: `No RMD — owner is age ${ageAtYearEnd}; SECURE 2.0 RMD start age is ${startAge}.`,
        notes,
      };
    }
    const divisor = uniformLifetimeDivisor(ageAtYearEnd);
    const amount = balance.div(divisor).toDecimalPlaces(2);

    if (
      input.accountType === "401k" ||
      input.accountType === "403b" ||
      input.accountType === "457b"
    ) {
      notes.push(
        "Employer-sponsored plan RMDs are calculated per plan; aggregation across multiple 401(k)s/403(b)s is NOT permitted (unlike IRAs).",
      );
    }
    if (input.accountType === "roth_ira") {
      notes.push(
        "SECURE 2.0 §325: Roth IRAs are not subject to RMDs during the owner's lifetime (effective for tax years beginning after 2023).",
      );
    }

    return {
      rmdRequired: true,
      rmdAmount: amount.toNumber(),
      divisor,
      startAge,
      ageAtYearEnd,
      mode: input.mode,
      rule: `Uniform Lifetime divisor ${divisor} at age ${ageAtYearEnd}`,
      notes,
    };
  },
  narrate(input, output) {
    if (!output.rmdRequired) return output.rule;
    return (
      `${output.mode === "single_life" ? "Inherited-account" : "Owner"} RMD for ${input.distributionYear}: ` +
      `prior-year balance $${input.priorYearEndBalance.toLocaleString("en-US")} ÷ ${output.divisor} = ` +
      `$${output.rmdAmount.toLocaleString("en-US")}. ${output.rule}.`
    );
  },
};

registerCalculator(rmd);

export { rmd };
