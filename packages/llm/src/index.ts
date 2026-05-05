export const LLM_PACKAGE = "@vibe-calc/llm" as const;

export * from "./types.js";
export * from "./loan-extraction.js";
export { AnthropicProvider, type AnthropicConfig } from "./anthropic.js";
export { LocalProvider, type LocalProviderConfig } from "./local.js";
