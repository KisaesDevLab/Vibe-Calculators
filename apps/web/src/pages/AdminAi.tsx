import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, CheckCircle2, XCircle, Loader2, FlaskConical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Phase 23.4 — AI provider status page.
 *
 * Read-only view of whether the LLM provider is configured (driven by
 * the appliance's .env), plus a "Send test prompt" action that fires
 * a small request and reports the round-trip details. The key itself
 * is masked — only the prefix is surfaced.
 */

interface AiStatus {
  configured: boolean;
  provider: string | null;
  defaultModel: string | null;
  apiKeyHint: string | null;
  offline: boolean;
}

interface AiTestResult {
  ok: boolean;
  provider: string;
  elapsedMs: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

interface AiUsage {
  windowDays: number;
  since: string;
  rates: { inputPerM: number; outputPerM: number };
  totals: {
    calls: number;
    succeeded: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  perUser: Array<{
    userId: string;
    name: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  perDay: Array<{
    day: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function AdminAiPage(): JSX.Element {
  const status = useQuery({
    queryKey: ["admin", "ai", "status"],
    queryFn: () => call<AiStatus>("/api/v1/admin/ai"),
  });
  const usage = useQuery({
    queryKey: ["admin", "ai", "usage"],
    queryFn: () => call<AiUsage>("/api/v1/admin/ai/usage?days=30"),
  });

  const [prompt, setPrompt] = useState("Reply with exactly the word: ok");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);

  async function runTest(): Promise<void> {
    setTesting(true);
    setResult(null);
    try {
      const r = await call<AiTestResult>("/api/v1/admin/ai/test", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setResult(r);
      toast.success(`Round-trip ${r.elapsedMs}ms, ${r.outputTokens} output tokens.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> AI provider
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 23 loan-extraction reads{" "}
          <code className="rounded bg-muted px-1 text-xs">ANTHROPIC_API_KEY</code> from the
          appliance <code className="rounded bg-muted px-1 text-xs">.env</code> at boot. To rotate
          the key, update <code className="rounded bg-muted px-1 text-xs">.env</code> and restart
          the server container. This page surfaces current status and lets you smoke-test the
          credential.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
          {status.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {status.isError && (
            <p className="text-sm text-destructive">{String((status.error as Error).message)}</p>
          )}
          {status.data && (
            <div className="space-y-2 text-sm">
              <Row
                label="Provider configured"
                value={
                  status.data.configured ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" /> Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <XCircle className="h-4 w-4" /> No (set ANTHROPIC_API_KEY in .env)
                    </span>
                  )
                }
              />
              <Row label="Provider" value={status.data.provider ?? "—"} />
              <Row label="Default model" value={status.data.defaultModel ?? "(provider default)"} />
              <Row
                label="API key prefix"
                value={status.data.apiKeyHint ? <code>{status.data.apiKeyHint}</code> : "—"}
              />
              <Row
                label="Offline mode"
                value={
                  status.data.offline ? (
                    <span className="text-amber-600">Yes — cloud calls disabled</span>
                  ) : (
                    "No"
                  )
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Usage (rolling 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {usage.isError && (
            <p className="text-sm text-destructive">{String((usage.error as Error).message)}</p>
          )}
          {usage.data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Calls" value={usage.data.totals.calls.toLocaleString()} />
                <Stat
                  label="Succeeded"
                  value={`${usage.data.totals.succeeded} / ${usage.data.totals.calls}`}
                />
                <Stat
                  label="Tokens (in / out)"
                  value={`${usage.data.totals.inputTokens.toLocaleString()} / ${usage.data.totals.outputTokens.toLocaleString()}`}
                />
                <Stat
                  label="Cost"
                  value={`$${usage.data.totals.costUsd.toLocaleString("en-US", { minimumFractionDigits: 4 })}`}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Rates: ${usage.data.rates.inputPerM.toFixed(2)}/M input, $
                {usage.data.rates.outputPerM.toFixed(2)}/M output. Override via
                VIBE_LLM_PRICE_INPUT_PER_M / OUTPUT_PER_M env.
              </p>
              {usage.data.perUser.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Per user
                  </p>
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1">User</th>
                        <th className="px-2 py-1 text-right">Calls</th>
                        <th className="px-2 py-1 text-right">Tokens</th>
                        <th className="px-2 py-1 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.data.perUser.map((r) => (
                        <tr key={r.userId} className="border-b">
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-right">{r.calls}</td>
                          <td className="px-2 py-1 text-right">
                            {(r.inputTokens + r.outputTokens).toLocaleString()}
                          </td>
                          <td className="px-2 py-1 text-right">
                            ${r.costUsd.toLocaleString("en-US", { minimumFractionDigits: 4 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" /> Send test prompt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Prompt (≤ 500 chars, max 32 output tokens, temperature 0)
            </span>
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="mt-3">
            <Button onClick={() => void runTest()} disabled={testing || !status.data?.configured}>
              {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {testing ? "Calling provider…" : "Send"}
            </Button>
          </div>
          {result && (
            <div className="mt-4 space-y-2 rounded-md border border-input p-3 text-sm">
              <Row label="Provider" value={result.provider} />
              <Row label="Round-trip" value={`${result.elapsedMs} ms`} />
              <Row label="Tokens" value={`${result.inputTokens} in / ${result.outputTokens} out`} />
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Response</p>
                <pre className="whitespace-pre-wrap rounded bg-muted px-2 py-1 text-xs">
                  {result.text}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-input p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 text-xs uppercase text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
