import { Router, type Request, type Response } from "express";
import { zodToJsonSchema } from "zod-to-json-schema";
import { listCalculators, getCalculator, type AnyTaxCalculator } from "@vibe-calc/tax-engine";
import type { Database, TaxTableKind, ResolvedTaxRow } from "@vibe-calc/db";
import { resolveTaxRows } from "@vibe-calc/db";
import { calculatorMemoToPdf } from "@vibe-calc/pdf";
import { problem } from "../middleware/auth.js";
import { loadFirmSettings, composeBrandedFooter } from "../lib/firm-settings.js";

/**
 * Phase 15.3 / 15.4 — registry-driven HTTP surface.
 *
 *   GET  /api/v1/calculators            — catalog: every registered
 *                                          calculator's metadata + Zod
 *                                          input/output schemas converted
 *                                          to JSON-Schema for the
 *                                          web auto-form generator.
 *   POST /api/v1/calculators/:kind/compute — validate input via the
 *                                          calculator's own
 *                                          validateInputs(), resolve any
 *                                          required tax-year tables,
 *                                          run compute(), return
 *                                          { output, narrative }.
 *
 * The catalog is the single source of truth: there is no separate
 * client-side registry. The web app fetches /calculators on load and
 * renders the picker entirely from that response.
 */

export interface CalculatorsRouteDeps {
  db: Database;
}

interface CatalogEntry {
  kind: string;
  name: string;
  description: string;
  category: string;
  taxYears: number[];
  formReferences: string[];
  requiredTables: TaxTableKind[];
  inputSchema: unknown;
  outputSchema: unknown;
}

function categoryFor(kind: string): string {
  if (kind.startsWith("tvm.")) return "TVM templates";
  if (
    kind.startsWith("tax.macrs") ||
    kind === "tax.section-179" ||
    kind === "tax.bonus-168k" ||
    kind === "tax.depreciation-waterfall" ||
    kind === "tax.cost-segregation"
  )
    return "Depreciation";
  if (
    kind === "tax.rmd" ||
    kind === "tax.roth-conversion" ||
    kind === "tax.qualified-plan-limits" ||
    kind === "tax.social-security" ||
    kind === "tax.hsa"
  )
    return "Retirement";
  if (
    kind === "tax.safe-harbor" ||
    kind === "tax.se-tax" ||
    kind === "tax.state-tax" ||
    kind === "tax.annualization"
  )
    return "Estimated tax";
  if (
    kind === "tax.capital-gains" ||
    kind === "tax.section-1031" ||
    kind === "tax.installment-sale" ||
    kind === "tax.section-121"
  )
    return "Capital";
  if (kind === "tax.amt" || kind === "tax.qbi" || kind === "tax.irs-interest") return "Other tax";
  return "Other";
}

function entryFor(calc: AnyTaxCalculator): CatalogEntry {
  return {
    kind: calc.metadata.kind,
    name: calc.metadata.name,
    description: calc.metadata.description,
    category: categoryFor(calc.metadata.kind),
    taxYears: calc.metadata.taxYears,
    formReferences: calc.metadata.formReferences,
    requiredTables: calc.metadata.requiredTables,
    inputSchema: zodToJsonSchema(calc.inputSchema, { target: "jsonSchema7" }),
    outputSchema: zodToJsonSchema(calc.outputSchema, { target: "jsonSchema7" }),
  };
}

export function buildCalculatorsRouter(deps: CalculatorsRouteDeps): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => {
    if (!req.user) {
      return problem(res, 401, "Unauthorized", "Authentication required");
    }
    // Hide the internal toy-double calculator from the user-facing
    // catalog. It exists only for the Phase 15.7 fixture-runner self-
    // tests and would confuse a CPA browsing the picker.
    const all = listCalculators().filter((c) => c.metadata.kind !== "tax.toy-double");
    const catalog = all.map(entryFor).sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });
    res.json({ calculators: catalog });
  });

  router.get("/:kind", (req: Request, res: Response) => {
    if (!req.user) {
      return problem(res, 401, "Unauthorized", "Authentication required");
    }
    const kindParam = req.params.kind;
    const kind = typeof kindParam === "string" ? kindParam : "";
    const calc = getCalculator(kind);
    if (!calc || calc.metadata.kind === "tax.toy-double") {
      return problem(res, 404, "Not Found", `No calculator with kind '${kind}'`);
    }
    res.json(entryFor(calc));
  });

  router.post("/:kind/compute", async (req: Request, res: Response) => {
    if (!req.user) {
      return problem(res, 401, "Unauthorized", "Authentication required");
    }
    const kindParam = req.params.kind;
    const kind = typeof kindParam === "string" ? kindParam : "";
    const calc = getCalculator(kind);
    if (!calc || calc.metadata.kind === "tax.toy-double") {
      return problem(res, 404, "Not Found", `No calculator with kind '${kind}'`);
    }

    const validation = calc.validateInputs(req.body);
    if (!validation.ok) {
      return problem(res, 400, "Validation failed", "One or more inputs failed validation", {
        issues: validation.issues,
      });
    }

    // Resolve any required tax tables. The asOf date is taken from
    // the body's `asOf` if present (so a recompute can pin to the
    // original date), otherwise today.
    const asOf =
      typeof req.body === "object" &&
      req.body &&
      typeof (req.body as { asOf?: unknown }).asOf === "string"
        ? new Date((req.body as { asOf: string }).asOf)
        : new Date();

    let tables: Map<TaxTableKind, ResolvedTaxRow> = new Map();
    if (calc.metadata.requiredTables.length > 0) {
      const taxYearGuess: number =
        typeof (validation.value as { taxYear?: unknown }).taxYear === "number"
          ? (validation.value as { taxYear: number }).taxYear
          : asOf.getUTCFullYear();
      tables = await resolveTaxRows(
        deps.db,
        taxYearGuess,
        calc.metadata.requiredTables.map((kind) => ({ kind, asOf })),
      );
    }

    try {
      const output = calc.compute(validation.value, { asOf, tables });
      const narrative = calc.narrate(validation.value, output, { asOf, tables });
      res.json({
        kind,
        output,
        narrative,
        formReferences: calc.metadata.formReferences,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return problem(res, 422, "Compute failed", message);
    }
  });

  router.post("/:kind/pdf", async (req: Request, res: Response) => {
    if (!req.user) {
      return problem(res, 401, "Unauthorized", "Authentication required");
    }
    const kindParam = req.params.kind;
    const kind = typeof kindParam === "string" ? kindParam : "";
    const calc = getCalculator(kind);
    if (!calc || calc.metadata.kind === "tax.toy-double") {
      return problem(res, 404, "Not Found", `No calculator with kind '${kind}'`);
    }

    const validation = calc.validateInputs(req.body);
    if (!validation.ok) {
      return problem(res, 400, "Validation failed", "One or more inputs failed validation", {
        issues: validation.issues,
      });
    }
    const asOf = new Date();
    let tables: Map<TaxTableKind, ResolvedTaxRow> = new Map();
    if (calc.metadata.requiredTables.length > 0) {
      const taxYearGuess: number =
        typeof (validation.value as { taxYear?: unknown }).taxYear === "number"
          ? (validation.value as { taxYear: number }).taxYear
          : asOf.getUTCFullYear();
      tables = await resolveTaxRows(
        deps.db,
        taxYearGuess,
        calc.metadata.requiredTables.map((k) => ({ kind: k, asOf })),
      );
    }
    const firm = await loadFirmSettings(deps.db);
    try {
      const output = calc.compute(validation.value, { asOf, tables });
      const narrative = calc.narrate(validation.value, output, { asOf, tables });
      const brandedFooter = composeBrandedFooter(firm, undefined);
      const buf = await calculatorMemoToPdf({
        kind,
        name: calc.metadata.name,
        description: calc.metadata.description,
        inputs: validation.value as Record<string, unknown>,
        outputs: output as Record<string, unknown>,
        narrative,
        formReferences: calc.metadata.formReferences,
        preparedBy: req.user.name,
        preparedOn: asOf,
        ...(firm?.firmName ? { firmName: firm.firmName } : {}),
        ...(brandedFooter ? { firmFooter: brandedFooter } : {}),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${kind.replace(/[^a-z0-9_.-]/gi, "_")}-${asOf.toISOString().slice(0, 10)}.pdf"`,
      );
      res.send(buf);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return problem(res, 422, "PDF generation failed", message);
    }
  });

  return router;
}
