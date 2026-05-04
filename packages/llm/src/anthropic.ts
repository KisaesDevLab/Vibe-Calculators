import { LlmError, type LlmProvider, type LlmTextRequest, type LlmTextResponse } from "./types.js";

/**
 * Phase 23.2 — Anthropic API LLM provider.
 *
 * Bare-fetch impl against api.anthropic.com/v1/messages. No SDK
 * dependency to keep the appliance image small.
 *
 * Defaults to the latest Claude Sonnet 4.6 family for general-
 * purpose extraction. The build plan permits tuning via
 * `VIBE_LLM_DEFAULT_MODEL` env.
 */

export interface AnthropicConfig {
  apiKey: string;
  defaultModel?: string | undefined;
  /** Override for testing / staging. */
  endpoint?: string | undefined;
  /** API version header. */
  anthropicVersion?: string | undefined;
}

interface AnthropicResponseBody {
  id: string;
  model: string;
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
  error?: { type: string; message: string };
}

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_VERSION = "2023-06-01";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  constructor(private readonly cfg: AnthropicConfig) {}

  async generate(request: LlmTextRequest): Promise<LlmTextResponse> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.cfg.defaultModel ?? DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? 4096,
      messages: [{ role: "user", content: request.prompt }],
    };
    if (request.system) body.system = request.system;
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    // Tool-use is the canonical way to constrain JSON output. We
    // expose a single tool that mirrors the response schema; the
    // model's "use_tool" call is what we parse out.
    if (request.responseSchema) {
      body.tools = [
        {
          name: "emit_structured_response",
          description: "Emit the extracted fields as a JSON object matching the supplied schema.",
          input_schema: request.responseSchema,
        },
      ];
      body.tool_choice = { type: "tool", name: "emit_structured_response" };
    }

    const res = await fetch(this.cfg.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": this.cfg.anthropicVersion ?? DEFAULT_VERSION,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as AnthropicResponseBody;
    if (!res.ok || json.error) {
      throw new LlmError(
        this.name,
        res.status,
        json.error?.message ?? `Anthropic HTTP ${res.status}`,
      );
    }

    // Pull out either tool input (preferred) or the first text block.
    const textParts: string[] = [];
    for (const block of json.content) {
      if (block.type === "text" && typeof block.text === "string") textParts.push(block.text);
      if (block.type === "tool_use") {
        // tool_use blocks shape: { type, id, name, input }. The
        // structured input is what we want; serialize back to JSON
        // so the caller can JSON.parse() with the same code path.
        const blk = block as unknown as { type: string; input: unknown };
        textParts.push(JSON.stringify(blk.input));
      }
    }

    return {
      text: textParts.join("\n"),
      responseId: json.id,
      model: json.model,
      inputTokens: json.usage.input_tokens,
      outputTokens: json.usage.output_tokens,
      provider: this.name,
    };
  }
}
