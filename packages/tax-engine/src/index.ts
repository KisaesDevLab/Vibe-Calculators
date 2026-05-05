export const TAX_ENGINE_PACKAGE = "@vibe-calc/tax-engine" as const;

export * from "./types.js";
export * from "./registry.js";
// fixture-runner is test-only — it imports `vitest` (a dev dep).
// Re-exporting it here would pull vitest into every prod-side import
// of @vibe-calc/tax-engine and break the distroless API container
// with ERR_MODULE_NOT_FOUND at boot. Tests import it directly via
// "../fixture-runner.js" or "@vibe-calc/tax-engine/fixture-runner".

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
import "./calculators/amt.js";
import "./calculators/section-1031.js";
import "./calculators/installment-sale.js";
import "./calculators/section-121.js";
import "./calculators/irs-interest.js";
import "./calculators/hsa.js";
import "./calculators/qualified-plan-limits.js";
import "./calculators/social-security.js";
