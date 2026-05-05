import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Plus, CheckCircle2, Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Phase 23.17 — versioned AI prompt admin.
 *
 * Lists every prompt by (kind, version DESC), lets the operator
 * draft a new version, activate one, or archive an old one. Only
 * one prompt per kind is `active` at a time.
 */

interface PromptRow {
  id: string;
  kind: string;
  version: number;
  body: string;
  systemMessage: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  archivedAt: string | null;
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

export function AdminAiPromptsPage(): JSX.Element {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "ai-prompts"],
    queryFn: () => call<{ prompts: PromptRow[] }>("/api/v1/admin/ai-prompts"),
  });

  const [kind, setKind] = useState("loan-extraction");
  const [body, setBody] = useState("");
  const [systemMessage, setSystemMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  async function create(): Promise<void> {
    if (!kind.trim() || body.trim().length < 10) {
      toast.error("Kind and a non-trivial body are required.");
      return;
    }
    setCreating(true);
    try {
      await call("/api/v1/admin/ai-prompts", {
        method: "POST",
        body: JSON.stringify({
          kind: kind.trim(),
          body,
          systemMessage: systemMessage || undefined,
          notes: notes || undefined,
        }),
      });
      setBody("");
      setSystemMessage("");
      setNotes("");
      await qc.invalidateQueries({ queryKey: ["admin", "ai-prompts"] });
      toast.success("New prompt version drafted (not yet active).");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function activate(p: PromptRow): Promise<void> {
    if (
      !confirm(
        `Activate ${p.kind} v${p.version}? Every other prompt of this kind will be deactivated.`,
      )
    )
      return;
    try {
      await call(`/api/v1/admin/ai-prompts/${p.id}/activate`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["admin", "ai-prompts"] });
      toast.success(`Activated ${p.kind} v${p.version}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function archive(p: PromptRow): Promise<void> {
    if (!confirm(`Archive ${p.kind} v${p.version}? The row stays in the audit trail.`)) return;
    try {
      await call(`/api/v1/admin/ai-prompts/${p.id}/archive`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["admin", "ai-prompts"] });
      toast.success(`Archived ${p.kind} v${p.version}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> AI prompts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Versioned prompt store for the LLM extraction flow. Each kind has at most one active row;
          new versions land inactive (draft) and the operator activates them explicitly.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Draft new version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Kind">
              <Input
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="loan-extraction"
              />
            </Field>
            <Field label="Notes (internal)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <Field label="System message (optional)">
            <textarea
              className="h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
              value={systemMessage}
              onChange={(e) => setSystemMessage(e.target.value)}
              placeholder="You are an extraction system for a CPA firm…"
            />
          </Field>
          <Field label="Prompt body">
            <textarea
              className="h-56 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Extract the loan-agreement terms from the document below…"
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={() => void create()} disabled={creating}>
              <Plus className="mr-1 h-4 w-4" />
              {creating ? "Drafting…" : "Draft new version"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All versions</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {list.isError && (
            <p className="text-sm text-destructive">{String((list.error as Error).message)}</p>
          )}
          {list.data && list.data.prompts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No prompts yet — extraction falls back to the hardcoded prompt in
              @vibe-calc/llm/loan-extraction.
            </p>
          )}
          {list.data && list.data.prompts.length > 0 && (
            <div className="space-y-3">
              {list.data.prompts.map((p) => (
                <div key={p.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{p.kind}</span>
                    <span className="text-xs text-muted-foreground">v{p.version}</span>
                    {p.active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> active
                      </span>
                    )}
                    {p.archivedAt && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        archived
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(p.createdAt).toISOString().slice(0, 19).replace("T", " ")}
                    </span>
                  </div>
                  {p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}
                  {p.systemMessage && (
                    <pre className="mt-2 max-h-24 overflow-y-auto rounded bg-muted px-2 py-1 text-xs">
                      {p.systemMessage}
                    </pre>
                  )}
                  <pre className="mt-2 max-h-48 overflow-y-auto rounded bg-muted px-2 py-1 text-xs">
                    {p.body}
                  </pre>
                  <div className="mt-2 flex justify-end gap-2">
                    {!p.active && !p.archivedAt && (
                      <Button variant="outline" size="sm" onClick={() => void activate(p)}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Activate
                      </Button>
                    )}
                    {!p.archivedAt && (
                      <Button variant="ghost" size="sm" onClick={() => void archive(p)}>
                        <Archive className="mr-1 h-3 w-3" /> Archive
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
