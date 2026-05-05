import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  FlaskConical,
  Save,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Phase 23.4 — AI provider configuration UI.
 *
 * DB-backed config that overrides .env. Three sections:
 *   1. Status — current resolved provider, model, source.
 *   2. Provider settings — pick anthropic / local / none, paste API
 *      key (masked once stored), pick / type a model.
 *   3. Test — fire a small prompt against the resolved provider with
 *      optional per-call model override.
 *   4. Usage — rolling 30-day cost ledger (existing).
 */

type Provider = "anthropic" | "local";

interface AiStatus {
  configured: boolean;
  provider: Provider | null;
  defaultModel: string | null;
  source: "db" | "env" | null;
  apiKeyHint: string | null;
  localUrl?: string | null;
  offline: boolean;
}

interface AiSettings {
  activeProvider: Provider | null;
  anthropicApiKeyPrefix: string | null;
  anthropicDefaultModel: string | null;
  localBaseUrl: string | null;
  localDefaultModel: string | null;
  localApiKeyConfigured: boolean;
  updatedAt: string;
}

interface AiSettingsResponse {
  settings: AiSettings;
  envFallback: {
    anthropicApiKeySet: boolean;
    anthropicDefaultModel: string | null;
    localBaseUrl: string | null;
    localDefaultModel: string | null;
    offline: boolean;
  };
}

interface ModelInfo {
  id: string;
  label: string;
}

interface ModelsResponse {
  models: ModelInfo[];
  source: "live" | "curated";
}

interface AiTestResult {
  ok: boolean;
  provider: string;
  model?: string;
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
    let detail = res.statusText;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function AdminAiPage(): JSX.Element {
  const status = useQuery({
    queryKey: ["admin", "ai", "status"],
    queryFn: () => call<AiStatus>("/api/v1/admin/ai"),
  });
  const settingsQ = useQuery({
    queryKey: ["admin", "ai", "settings"],
    queryFn: () => call<AiSettingsResponse>("/api/v1/admin/ai/settings"),
  });
  const usage = useQuery({
    queryKey: ["admin", "ai", "usage"],
    queryFn: () => call<AiUsage>("/api/v1/admin/ai/usage?days=30"),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> AI provider
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the AI provider used for loan-agreement extraction (Phase 23). Settings here
          override the boot-time <code className="rounded bg-muted px-1 text-xs">.env</code>{" "}
          fallback and take effect immediately — no server restart.
        </p>
      </header>

      <StatusCard status={status} />

      {settingsQ.data && (
        <SettingsCard
          initial={settingsQ.data}
          onSaved={() => {
            void status.refetch();
            void settingsQ.refetch();
          }}
        />
      )}

      <UsageCard usage={usage} />

      <TestCard configured={status.data?.configured === true} />
    </main>
  );
}

function StatusCard({ status }: { status: ReturnType<typeof useQuery<AiStatus>> }): JSX.Element {
  return (
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
                    <CheckCircle2 className="h-4 w-4" /> Yes ({status.data.source ?? "?"})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" /> No — set the API key below
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
            {status.data.provider === "local" && (
              <Row
                label="Local LLM URL"
                value={status.data.localUrl ? <code>{status.data.localUrl}</code> : "—"}
              />
            )}
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
  );
}

function SettingsCard({
  initial,
  onSaved,
}: {
  initial: AiSettingsResponse;
  onSaved: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [activeProvider, setActiveProvider] = useState<Provider | "none">(
    initial.settings.activeProvider ?? "none",
  );
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [anthropicModel, setAnthropicModel] = useState(
    initial.settings.anthropicDefaultModel ?? "",
  );
  const [localUrl, setLocalUrl] = useState(initial.settings.localBaseUrl ?? "");
  const [localModel, setLocalModel] = useState(initial.settings.localDefaultModel ?? "");
  const [localKey, setLocalKey] = useState("");
  const [showLocalKey, setShowLocalKey] = useState(false);

  const anthropicModels = useQuery({
    queryKey: ["admin", "ai", "models", "anthropic"],
    queryFn: () => call<ModelsResponse>("/api/v1/admin/ai/models?provider=anthropic"),
  });
  const localModels = useQuery({
    queryKey: ["admin", "ai", "models", "local", initial.settings.localBaseUrl],
    queryFn: () => call<ModelsResponse>("/api/v1/admin/ai/models?provider=local"),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      call<void>("/api/v1/admin/ai/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("AI provider settings saved");
      setAnthropicKey("");
      setLocalKey("");
      onSaved();
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit(): void {
    const body: Record<string, unknown> = {
      activeProvider: activeProvider === "none" ? null : activeProvider,
    };
    if (anthropicModel !== (initial.settings.anthropicDefaultModel ?? "")) {
      body.anthropicDefaultModel = anthropicModel || null;
    }
    if (anthropicKey.length > 0) body.anthropicApiKey = anthropicKey;
    if (localUrl !== (initial.settings.localBaseUrl ?? "")) {
      body.localBaseUrl = localUrl || null;
    }
    if (localModel !== (initial.settings.localDefaultModel ?? "")) {
      body.localDefaultModel = localModel || null;
    }
    if (localKey.length > 0) body.localApiKey = localKey;
    save.mutate(body);
  }

  function clearAnthropicKey(): void {
    save.mutate({
      activeProvider: activeProvider === "none" ? null : activeProvider,
      clearAnthropicApiKey: true,
    });
  }

  function clearLocalKey(): void {
    save.mutate({
      activeProvider: activeProvider === "none" ? null : activeProvider,
      clearLocalApiKey: true,
    });
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Provider settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Active provider
          </p>
          <div className="flex gap-2">
            {(["none", "anthropic", "local"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setActiveProvider(p)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm capitalize " +
                  (activeProvider === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-accent")
                }
              >
                {p === "none" ? "None (use .env)" : p}
              </button>
            ))}
          </div>
          {initial.envFallback.offline && activeProvider === "anthropic" && (
            <p className="mt-2 text-xs text-amber-600">
              Offline mode is enabled in <code>.env</code>; the Anthropic selection will be ignored
              at request time and the local provider will be used (or 503 if no local gateway is
              configured).
            </p>
          )}
        </div>

        {/* Anthropic */}
        <div className="rounded-md border border-input p-4">
          <h3 className="mb-3 text-sm font-medium">Anthropic Cloud (Claude)</h3>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                API key
              </span>
              <div className="flex gap-2">
                <Input
                  type={showAnthropicKey ? "text" : "password"}
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={
                    initial.settings.anthropicApiKeyPrefix
                      ? `Currently set: ${initial.settings.anthropicApiKeyPrefix}`
                      : "sk-ant-…"
                  }
                  autoComplete="off"
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAnthropicKey((v) => !v)}
                >
                  {showAnthropicKey ? "Hide" : "Show"}
                </Button>
                {initial.settings.anthropicApiKeyPrefix && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => clearAnthropicKey()}
                    disabled={save.isPending}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Stored AES-GCM-sealed (envelope-encrypted with VIBE_KMS_KEY). Leave blank to keep
                the existing key.
              </p>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Default model
              </span>
              <ModelPicker
                value={anthropicModel}
                onChange={setAnthropicModel}
                models={anthropicModels.data?.models ?? []}
                loading={anthropicModels.isLoading}
                source={anthropicModels.data?.source}
                fallback="claude-sonnet-4-6"
              />
            </label>
          </div>
        </div>

        {/* Local */}
        <div className="rounded-md border border-input p-4">
          <h3 className="mb-3 text-sm font-medium">Local OpenAI-compatible gateway</h3>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Base URL
              </span>
              <Input
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                placeholder="http://vibe-llm:8080/v1"
                className="font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Required for local provider. Cloud-metadata oracles (169.254.169.254) are blocked.
              </p>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                API key (optional)
              </span>
              <div className="flex gap-2">
                <Input
                  type={showLocalKey ? "text" : "password"}
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  placeholder={
                    initial.settings.localApiKeyConfigured
                      ? "(currently set — leave blank to keep)"
                      : "(leave blank if your gateway needs no auth)"
                  }
                  autoComplete="off"
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLocalKey((v) => !v)}
                >
                  {showLocalKey ? "Hide" : "Show"}
                </Button>
                {initial.settings.localApiKeyConfigured && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => clearLocalKey()}
                    disabled={save.isPending}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Default model
              </span>
              <div className="flex gap-2">
                <ModelPicker
                  value={localModel}
                  onChange={setLocalModel}
                  models={localModels.data?.models ?? []}
                  loading={localModels.isLoading}
                  source={localModels.data?.source}
                  fallback="qwen3-8b"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void localModels.refetch()}
                  title="Refresh model list from gateway"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={save.isPending}>
            <Save className="mr-1 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ModelPicker({
  value,
  onChange,
  models,
  loading,
  source,
  fallback,
}: {
  value: string;
  onChange: (v: string) => void;
  models: ModelInfo[];
  loading: boolean;
  source: "live" | "curated" | undefined;
  fallback: string;
}): JSX.Element {
  // If the current value isn't in the model list, treat it as custom.
  const inList = models.some((m) => m.id === value);
  const [custom, setCustom] = useState(value !== "" && !inList);

  useEffect(() => {
    setCustom(value !== "" && !models.some((m) => m.id === value));
  }, [models, value]);

  if (custom) {
    return (
      <div className="flex flex-1 gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="font-mono text-sm"
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setCustom(false)}>
          Pick from list
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">(provider default — {fallback})</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <Button type="button" variant="ghost" size="sm" onClick={() => setCustom(true)}>
        Custom…
      </Button>
      {loading && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" />}
      {source === "live" && (
        <span className="self-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase text-emerald-700 dark:text-emerald-400">
          live
        </span>
      )}
    </div>
  );
}

function UsageCard({ usage }: { usage: ReturnType<typeof useQuery<AiUsage>> }): JSX.Element {
  return (
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
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Per user</p>
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
  );
}

function TestCard({ configured }: { configured: boolean }): JSX.Element {
  const [prompt, setPrompt] = useState("Reply with exactly the word: ok");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);

  async function runTest(): Promise<void> {
    setTesting(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { prompt };
      if (model.length > 0) body.model = model;
      const r = await call<AiTestResult>("/api/v1/admin/ai/test", {
        method: "POST",
        body: JSON.stringify(body),
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
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            Model override (optional)
          </span>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="(use the configured default)"
            className="font-mono text-sm"
          />
        </label>
        <div className="mt-3">
          <Button onClick={() => void runTest()} disabled={testing || !configured}>
            {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {testing ? "Calling provider…" : "Send"}
          </Button>
        </div>
        {result && (
          <div className="mt-4 space-y-2 rounded-md border border-input p-3 text-sm">
            <Row label="Provider" value={result.provider} />
            {result.model && <Row label="Model" value={<code>{result.model}</code>} />}
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
