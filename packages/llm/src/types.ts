/**
 * Phase 23 — pluggable LLM providers.
 *
 * Per the architecture in CLAUDE.md the future Tier-1 path is a
 * local Qwen3-8B server; Tier-2 is the Anthropic API. The
 * interface here is small enough to support both. For Phase 23 the
 * user has scoped the build to the Anthropic impl only.
 */

export interface LlmTextRequest {
  /** Plain-text prompt (or JSON-serialized chat history). */
  prompt: string;
  /** Optional system instruction prepended above the user prompt. */
  system?: string;
  /** Max output tokens. Provider may further cap. */
  maxTokens?: number;
  temperature?: number;
  /** Provider-specific model identifier. Optional; provider has a default. */
  model?: string;
  /** Force the response to a JSON object matching `responseSchema`. */
  responseSchema?: Record<string, unknown>;
}

export interface LlmTextResponse {
  text: string;
  /** Provider-side identifier for audit. */
  responseId: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider name (lower-case) for tracing. */
  provider: string;
  /** Model id actually used. */
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  generate(request: LlmTextRequest): Promise<LlmTextResponse>;
}

export class LlmError extends Error {
  constructor(
    public readonly provider: string,
    public readonly statusCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
