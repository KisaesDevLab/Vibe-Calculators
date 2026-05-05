import { LlmError, type LlmProvider, type LlmTextRequest, type LlmTextResponse } from "./types.js";

/**
 * Phase 23.3 — Local LLM provider.
 *
 * Speaks the OpenAI chat-completions wire format so it can drive
 * vibe-llm-server (llama.cpp) or any other OpenAI-compatible
 * gateway hosting Qwen3-8B / Llama-3 / etc. JSON Schema constraint
 * is delivered via the `response_format` field
 * (`{ type: "json_schema", json_schema: ... }`); servers that don't
 * support it fall through to free-form completion and we rely on
 * downstream Zod parsing.
 *
 * Why a local provider matters: when `VIBE_OFFLINE=true` the
 * appliance must run extractions without leaving the LAN. Operators
 * deploy vibe-llm-server alongside this stack and point the
 * `VIBE_LLM_LOCAL_URL` at it.
 */

export interface LocalProviderConfig {
  /** Base URL of the OpenAI-compatible server (e.g. http://vibe-llm:8080/v1). */
  baseUrl: string;
  /** Default model identifier (e.g. "qwen3-8b"). */
  defaultModel?: string | undefined;
  /** Optional bearer token if the gateway requires one. */
  apiKey?: string | undefined;
  /** Per-call request timeout in ms. Defaults to 120s — local CPU inference can be slow. */
  timeoutMs?: number | undefined;
}

interface ChatChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason?: string;
}

interface ChatResponseBody {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message: string; type?: string };
}

const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MODEL = "qwen3-8b";

export class LocalProvider implements LlmProvider {
  readonly name = "local";
  constructor(private readonly cfg: LocalProviderConfig) {
    if (!cfg.baseUrl || cfg.baseUrl.trim().length === 0) {
      throw new Error("LocalProvider: baseUrl is required");
    }
  }

  async generate(request: LlmTextRequest): Promise<LlmTextResponse> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = {
      model: request.model ?? this.cfg.defaultModel ?? DEFAULT_MODEL,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0,
      stream: false,
    };
    if (request.responseSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "structured_response",
          schema: request.responseSchema,
          strict: true,
        },
      };
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? DEFAULT_TIMEOUT);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmError(
        this.name,
        undefined,
        `Local LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(t);
    }

    let json: ChatResponseBody;
    try {
      json = (await res.json()) as ChatResponseBody;
    } catch (err) {
      throw new LlmError(
        this.name,
        res.status,
        `Local LLM returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok || json.error) {
      throw new LlmError(
        this.name,
        res.status,
        json.error?.message ?? `Local LLM HTTP ${res.status}`,
      );
    }

    const choice = json.choices?.[0];
    if (!choice || !choice.message) {
      throw new LlmError(this.name, res.status, "Local LLM response missing choices[0].message");
    }
    const text = choice.message.content ?? "";

    return {
      text,
      responseId: json.id,
      model: json.model,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      provider: this.name,
    };
  }
}
