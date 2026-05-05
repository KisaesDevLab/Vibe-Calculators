import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/auth/api";

/**
 * Phase 11.9 / 21.2 — version history + side-by-side compare.
 *
 * Lists every saved version of a calculation, lets the operator
 * pick two and view the JSON diff. The diff endpoint already
 * computes a shallow key-level diff server-side; this page renders
 * it.
 *
 * Reachable at /calculations/:id/versions.
 */

interface VersionRow {
  id: string;
  version: number;
  inputsJson: Record<string, unknown>;
  outputsJson: Record<string, unknown>;
  notes: string | null;
  computedAt: string;
  computedBy: string | null;
}

interface DiffResponse {
  a: VersionRow;
  b: VersionRow;
  diff: {
    added: string[];
    removed: string[];
    changed: { key: string; from: unknown; to: unknown }[];
  };
}

async function call<T>(input: RequestInfo): Promise<T> {
  const res = await fetch(input, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export function CalculationVersionsPage(): JSX.Element {
  const { id = "" } = useParams();
  const list = useQuery({
    queryKey: ["calculations", id, "versions"],
    queryFn: () =>
      call<{ versions: VersionRow[] }>(`/api/v1/calculations/${encodeURIComponent(id)}/versions`),
    enabled: id !== "",
  });

  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const diff = useQuery({
    queryKey: ["calculations", id, "diff", a, b],
    queryFn: () =>
      call<DiffResponse>(
        `/api/v1/calculations/${encodeURIComponent(id)}/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
      ),
    enabled: a !== "" && b !== "" && a !== b,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/calculators"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Calculators
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Versions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Calculation <code className="rounded bg-muted px-1 text-xs">{id}</code>. Every save
          creates an immutable version row; rollback is non-destructive (creates a new version
          copying the chosen prior).
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {list.isError && (
            <p className="text-sm text-destructive">{String((list.error as Error).message)}</p>
          )}
          {list.data && list.data.versions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No saved versions yet. Save the calculation to start the history.
            </p>
          )}
          {list.data && list.data.versions.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Version</th>
                  <th className="px-2 py-2">Saved</th>
                  <th className="px-2 py-2">Author</th>
                  <th className="px-2 py-2">Notes</th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.data.versions.map((v) => (
                  <tr key={v.id} className="border-b">
                    <td className="px-2 py-2 font-medium">v{v.version}</td>
                    <td className="px-2 py-2 text-xs">
                      {v.computedAt.slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="px-2 py-2 text-xs">{v.computedBy?.slice(0, 8) ?? "—"}…</td>
                    <td className="px-2 py-2 text-xs">{v.notes ?? "—"}</td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        variant={a === v.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setA(v.id)}
                      >
                        Side A
                      </Button>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        variant={b === v.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setB(v.id)}
                      >
                        Side B
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompare className="h-4 w-4" /> Side-by-side
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!a || !b ? (
            <p className="text-sm text-muted-foreground">
              Pick two versions above (Side A and Side B) to see the diff.
            </p>
          ) : a === b ? (
            <p className="text-sm text-muted-foreground">Pick two different versions to compare.</p>
          ) : (
            <DiffPanel
              diff={diff.data}
              loading={diff.isLoading}
              error={diff.error as Error | null}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function DiffPanel({
  diff,
  loading,
  error,
}: {
  diff: DiffResponse | undefined;
  loading: boolean;
  error: Error | null;
}): JSX.Element {
  if (loading) return <p className="text-sm text-muted-foreground">Computing diff…</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!diff) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-md border border-input p-2">
          <p className="mb-1 font-medium">A: v{diff.a.version}</p>
          <p className="text-muted-foreground">
            {diff.a.computedAt.slice(0, 19).replace("T", " ")}
          </p>
        </div>
        <div className="rounded-md border border-input p-2">
          <p className="mb-1 font-medium">B: v{diff.b.version}</p>
          <p className="text-muted-foreground">
            {diff.b.computedAt.slice(0, 19).replace("T", " ")}
          </p>
        </div>
      </div>

      <Section title={`Added in B (${diff.diff.added.length})`} tone="add">
        {diff.diff.added.length === 0 ? (
          <p className="text-xs text-muted-foreground">none</p>
        ) : (
          <ul className="space-y-1">
            {diff.diff.added.map((k) => (
              <li key={k} className="font-mono text-xs">
                + {k}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Removed in B (${diff.diff.removed.length})`} tone="remove">
        {diff.diff.removed.length === 0 ? (
          <p className="text-xs text-muted-foreground">none</p>
        ) : (
          <ul className="space-y-1">
            {diff.diff.removed.map((k) => (
              <li key={k} className="font-mono text-xs">
                − {k}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Changed (${diff.diff.changed.length})`} tone="change">
        {diff.diff.changed.length === 0 ? (
          <p className="text-xs text-muted-foreground">none</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Key</th>
                <th className="py-1 pr-2">A</th>
                <th className="py-1">B</th>
              </tr>
            </thead>
            <tbody>
              {diff.diff.changed.map((c) => (
                <tr key={c.key} className="border-t border-border/50">
                  <td className="py-1 pr-2 font-mono">{c.key}</td>
                  <td className="py-1 pr-2 font-mono">{format(c.from)}</td>
                  <td className="py-1 font-mono">{format(c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "add" | "remove" | "change";
  children: React.ReactNode;
}): JSX.Element {
  const toneClass =
    tone === "add"
      ? "border-emerald-500/50 bg-emerald-500/5"
      : tone === "remove"
        ? "border-destructive/50 bg-destructive/5"
        : "border-amber-500/50 bg-amber-500/5";
  return (
    <div className={`rounded-md border ${toneClass} px-3 py-2`}>
      <p className="mb-1 text-xs font-medium uppercase">{title}</p>
      {children}
    </div>
  );
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
