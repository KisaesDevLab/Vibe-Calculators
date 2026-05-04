export const TAX_ENGINE_PACKAGE = "@vibe-calc/tax-engine" as const;

export * from "./types.js";
export * from "./registry.js";
export * from "./fixture-runner.js";

// Side-effecting imports below register calculators on the registry.
// Adding a new calculator means: write the module, add it here.
import "./calculators/toy-double.js";
import "./calculators/macrs.js";
import "./calculators/section-179.js";
import "./calculators/bonus-168k.js";
import "./calculators/depreciation-waterfall.js";
import "./calculators/cost-segregation.js";
import "./calculators/rmd.js";
import "./calculators/roth-conversion.js";
import "./calculators/capital-gains.js";
import "./calculators/qbi.js";
import "./calculators/se-tax.js";
import "./calculators/safe-harbor.js";
import "./calculators/state-tax.js";
import "./calculators/annualization.js";
