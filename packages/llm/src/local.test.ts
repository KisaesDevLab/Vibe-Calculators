import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalProvider } from "./local.js";
import { LlmError } from "./types.js";

/**
 * Phase 23.3 — local LLM provider wire-format tests.
 *
 * Locks in the OpenAI chat-completions request/response shape so a
 * future refactor can't silently break compatibility with
 * vibe-llm-server / llama.cpp / Ollama-compat / etc.
 */

describe("LocalProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("requires a base URL", () => {
    expect(() => new LocalProvider({ baseUrl: "" })).toThrow(/baseUrl is required/);
  });

  it("sends OpenAI chat-completions shape with system + user messages", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL, init: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          id: "resp-1",
          model: "qwen3-8b",
          choices: [{ index: 0, message: { role: "assistant", content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const provider = new LocalProvider({
      baseUrl: "http://vibe-llm:8080/v1",
      defaultModel: "qwen3-8b",
    });
    const out = await provider.generate({
      prompt: "do the thing",
      system: "be terse",
      maxTokens: 256,
      temperature: 0,
    });

    expect(captured?.url).toBe("http://vibe-llm:8080/v1/chat/completions");
    const body = JSON.parse(captured?.init.body as string);
    expect(body.model).toBe("qwen3-8b");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "do the thing" },
    ]);
    expect(out.text).toBe('{"ok":true}');
    expect(out.responseId).toBe("resp-1");
    expect(out.inputTokens).toBe(10);
    expect(out.outputTokens).toBe(5);
    expect(out.provider).toBe("local");
  });

  it("attaches JSON schema response_format when responseSchema is provided", async () => {
    let captured: { init: RequestInit } | undefined;
    globalThis.fetch = vi.fn(async (_url, init: RequestInit) => {
      captured = { init };
      return new Response(
        JSON.stringify({
          id: "r",
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "{}" } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = new LocalProvider({ baseUrl: "http://x" });
    await provider.generate({
      prompt: "p",
      responseSchema: { type: "object", properties: { a: { type: "string" } } },
    });
    const body = JSON.parse(captured!.init.body as string);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "structured_response",
        schema: { type: "object", properties: { a: { type: "string" } } },
        strict: true,
      },
    });
  });

  it("attaches Authorization bearer header when apiKey provided", async () => {
    let headers: Record<string, string> | undefined;
    globalThis.fetch = vi.fn(async (_url, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          id: "r",
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "" } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = new LocalProvider({ baseUrl: "http://x", apiKey: "secret-token" });
    await provider.generate({ prompt: "p" });
    expect(headers?.Authorization).toBe("Bearer secret-token");
  });

  it("throws LlmError with provider+status on non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "model unloaded" } }), {
        status: 503,
      });
    }) as unknown as typeof fetch;
    const provider = new LocalProvider({ baseUrl: "http://x" });
    try {
      await provider.generate({ prompt: "p" });
      throw new Error("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      const e = err as LlmError;
      expect(e.provider).toBe("local");
      expect(e.statusCode).toBe(503);
      expect(e.message).toMatch(/model unloaded/);
    }
  });

  it("strips trailing slash from baseUrl when composing /chat/completions", async () => {
    let captured: string | undefined;
    globalThis.fetch = vi.fn(async (url) => {
      captured = String(url);
      return new Response(
        JSON.stringify({
          id: "r",
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "" } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await new LocalProvider({ baseUrl: "http://x:8080/v1/" }).generate({ prompt: "p" });
    expect(captured).toBe("http://x:8080/v1/chat/completions");
  });

  it("aborts on timeout", async () => {
    globalThis.fetch = vi.fn(async (_url, init: RequestInit) => {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    const provider = new LocalProvider({ baseUrl: "http://x", timeoutMs: 50 });
    await expect(provider.generate({ prompt: "p" })).rejects.toThrow(/Local LLM request failed/);
  });
});
