import {
  VibeAiClient,
  VibeAiError,
  type ChatMessage,
  type CompletionResult,
} from "@kisaes/vibe-ai-client";
import { LlmError, type LlmProvider, type LlmTextRequest, type LlmTextResponse } from "./types.js";

/**
 * Vibe AI Router provider (dual-mode per the router-option addendum, Q-063/Q-064).
 *
 * When VIBE_AI_MODE=router, ALL AI traffic goes through the appliance's Vibe AI
 * Router: this app stops choosing providers and models — the task class is the only
 * knob, and router policy decides model, fallback, budgets, and scrubbing. `direct`
 * (the default) keeps the Anthropic/Local providers for standalone single-install
 * deployments, where no router exists.
 *
 * NO silent cross-mode fallback: a router outage surfaces as an LlmError. Quietly
 * retrying against a direct provider would ship the document text around the
 * router's scrubber and ledger.
 */

export interface RouterProviderConfig {
  /** e.g. http://vibe-ai-router:8220 (internal docker DNS on the appliance) */
  baseUrl: string;
  /** app token minted in the router console — never a provider key */
  token: string;
  /** task class attributed to generate() calls; the router derives everything from it */
  taskClass?: string | undefined;
  /** injectable for tests */
  fetch?: typeof fetch | undefined;
}

/** This app's task classes. New keys start local_only on the router until widened. */
export const CALC_TASK_CLASSES = {
  LOAN_EXTRACT: "calc_loan_extract",
} as const;

export class RouterProvider implements LlmProvider {
  readonly name = "vibe_router";
  private readonly client: VibeAiClient;
  private readonly taskClass: string;

  constructor(cfg: RouterProviderConfig) {
    if (!cfg.baseUrl || !cfg.token) {
      throw new Error("RouterProvider: baseUrl and token are required");
    }
    this.client = new VibeAiClient({
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    });
    this.taskClass = cfg.taskClass ?? CALC_TASK_CLASSES.LOAN_EXTRACT;
  }

  async generate(request: LlmTextRequest): Promise<LlmTextResponse> {
    const messages: ChatMessage[] = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });
    try {
      // request.model is deliberately NOT forwarded: in router mode, model choice is
      // router policy's job — an app-pinned model would bypass the admin's config.
      const options = {
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      };
      let result: CompletionResult;
      let text: string;
      if (request.responseSchema) {
        // completeJson covers how local models answer forced-JSON requests — tool-call
        // replies and markdown-fenced JSON. Re-serialize so callers keep the one
        // JSON.parse() code path shared with the other providers.
        const jsonResult = await this.client.completeJson<unknown>(
          this.taskClass,
          messages,
          { name: "extraction", schema: request.responseSchema },
          options,
        );
        result = jsonResult;
        text = JSON.stringify(jsonResult.data);
      } else {
        result = await this.client.complete(this.taskClass, messages, options);
        text = result.content;
      }
      return {
        text,
        responseId: result.requestId,
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        provider: this.name,
        model: result.model,
      };
    } catch (err) {
      if (err instanceof VibeAiError) {
        throw new LlmError(this.name, err.status, `Vibe AI Router: ${err.message} (${err.code})`);
      }
      throw new LlmError(
        this.name,
        undefined,
        `Vibe AI Router unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Declare this app's task classes on the router (idempotent, version-stamped).
 * Callers fire this at boot in router mode; failure must not block boot — the
 * router may not be healthy yet. Requests made before registration completes
 * fail closed at the router (unknown task class), which is correct.
 */
export async function registerCalcTaskClasses(cfg: {
  baseUrl: string;
  token: string;
  version: string;
  fetch?: typeof fetch;
}): Promise<{ registered: { key: string; created: boolean; sensitivity: string }[] }> {
  const client = new VibeAiClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  return client.registerTaskClasses({
    app: "vibe-calculators",
    version: cfg.version,
    classes: [
      {
        key: CALC_TASK_CLASSES.LOAN_EXTRACT,
        description: "Structured extraction of loan-agreement terms from document text",
        requires: { json_schema: true },
        defaultMaxTokens: 4096,
      },
    ],
  });
}
