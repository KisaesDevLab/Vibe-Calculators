export const TAX_ENGINE_PACKAGE = "@vibe-calc/tax-engine" as const;

export * from "./types.js";
export * from "./registry.js";
export * from "./fixture-runner.js";

// Side-effecting imports below register calculators on the registry.
// Adding a new calculator means: write the module, add it here.
import "./calculators/toy-double.js";
