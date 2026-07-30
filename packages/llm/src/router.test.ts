import { describe, expect, it, vi } from "vitest";
import { CALC_TASK_CLASSES, RouterProvider, registerCalcTaskClasses } from "./router.js";
import { LlmError } from "./types.js";

/**
 * MIG-9 — Vibe AI Router provider wire tests. Fetch is injected through the
 * provider config (never patched globally) and stubbed at the network edge,
 * locking in the router's OpenAI-compatible request shape: task class in the
 * X-Vibe-Task-Class header, app token as Bearer, json_schema response_format,
 * and NO model field (router policy chooses — an app-pinned model would
 * bypass the admin's config).
 */

function fetchAnswering(
  status: number,
  body: unknown,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(String(url), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req-test-1" },
    });
  }) as unknown as typeof fetch;
}

const COMPLETION = {
  model: "ollama/qwen3:14b",
  choices: [{ message: { content: '{"principal":250000}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 900, completion_tokens: 40 },
};

describe("RouterProvider", () => {
  it("requires baseUrl and token", () => {
    expect(() => new RouterProvider({ baseUrl: "", token: "t" })).toThrow(/required/);
    expect(() => new RouterProvider({ baseUrl: "http://r:8220", token: "" })).toThrow(/required/);
  });

  it("sends task class + Bearer token + json_schema, and never a model", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = new RouterProvider({
      baseUrl: "http://vibe-ai-router:8220",
      token: "vibe-calc-token",
      fetch: fetchAnswering(200, COMPLETION, (url, init) => (captured = { url, init })),
    });
    const res = await provider.generate({
      prompt: "extract terms",
      system: "you extract loans",
      maxTokens: 4096,
      temperature: 0,
      model: "claude-sonnet-4-6", // must be IGNORED — policy decides
      responseSchema: { type: "object", properties: { principal: { type: "number" } } },
    });

    expect(captured!.url).toBe("http://vibe-ai-router:8220/v1/chat/completions");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["x-vibe-task-class"]).toBe(CALC_TASK_CLASSES.LOAN_EXTRACT);
    expect(headers.authorization).toBe("Bearer vibe-calc-token");
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body.model).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    expect((body.messages as unknown[]).length).toBe(2);

    expect(res.text).toBe('{"principal":250000}');
    expect(res.provider).toBe("vibe_router");
    expect(res.model).toBe("ollama/qwen3:14b"); // what policy actually served
    expect(res.responseId).toBe("req-test-1");
    expect(res.inputTokens).toBe(900);
    expect(res.outputTokens).toBe(40);
  });

  it("maps router errors to LlmError with the router status — no fallback", async () => {
    const provider = new RouterProvider({
      baseUrl: "http://vibe-ai-router:8220",
      token: "t",
      fetch: fetchAnswering(403, {
        error: { code: "policy_blocked", message: "no enabled policy for task class" },
      }),
    });
    await expect(provider.generate({ prompt: "x" })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof LlmError &&
        e.provider === "vibe_router" &&
        e.statusCode === 403 &&
        /policy_blocked/.test(e.message),
    );
  });

  it("maps network failure to LlmError with an 'unreachable' message", async () => {
    const provider = new RouterProvider({
      baseUrl: "http://vibe-ai-router:8220",
      token: "t",
      fetch: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    await expect(provider.generate({ prompt: "x" })).rejects.toSatisfy(
      (e: unknown) => e instanceof LlmError && /unreachable/i.test(e.message),
    );
  });
});

describe("registerCalcTaskClasses", () => {
  it("declares calc_loan_extract with requires.json_schema", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const res = await registerCalcTaskClasses({
      baseUrl: "http://vibe-ai-router:8220",
      token: "t",
      version: "1.2.3",
      fetch: fetchAnswering(
        200,
        { registered: [{ key: "calc_loan_extract", created: true, sensitivity: "local_only" }] },
        (url, init) => (captured = { url, init }),
      ),
    });
    expect(captured!.url).toBe("http://vibe-ai-router:8220/v1/task-classes/register");
    const body = JSON.parse(String(captured!.init.body)) as {
      app: string;
      classes: { key: string; requires: Record<string, boolean> }[];
    };
    expect(body.app).toBe("vibe-calculators");
    expect(body.classes[0]!.key).toBe(CALC_TASK_CLASSES.LOAN_EXTRACT);
    expect(body.classes[0]!.requires).toEqual({ json_schema: true });
    expect(res.registered[0]!.sensitivity).toBe("local_only");
  });
});
