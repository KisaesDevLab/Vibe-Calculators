import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, History, FileArchive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/auth/api";

/**
 * Phase 11.8 / 11.10 — saved-calculations index.
 *
 * Lists every calculation visible to the current user (the /api/v1/
 * calculations route already enforces ownership / role scope). Each
 * row offers:
 *   - Open in workbench   → /calculators/tvm-workbench?id=…
 *   - What-if duplicate   → fetches inputs, drops them in
 *                            sessionStorage as a clone payload, opens
 *                            the workbench fresh-saved-state-clear
 *   - View versions       → /calculations/:id/versions
 */

interface CalculationRow {
  id: string;
  name: string;
  kind: string;
  status: "draft" | "ready_for_review" | "approved";
  version: number;
  clientId: string | null;
  engagementId: string | null;
  createdAt: string;
  updatedAt: string;
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
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export function CalculationsIndexPage(): JSX.Element {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["calculations", "index"],
    queryFn: () => call<{ calculations: CalculationRow[] }>("/api/v1/calculations?limit=100"),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll(rows: CalculationRow[]): void {
    setSelected((prev) =>
      prev.size === rows.length ? new Set<string>() : new Set(rows.map((r) => r.id)),
    );
  }

  async function exportZip(): Promise<void> {
    if (selected.size === 0) return;
    if (selected.size > 50) {
      toast.error("Bulk export limited to 50 calculations per call.");
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/v1/calculations/bulk/zip", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          detail = (JSON.parse(text) as { detail?: string }).detail ?? detail;
        } catch {
          // fall through
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `calculations-${new Date().toISOString().slice(0, 10)}-${selected.size}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${selected.size} calculations.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function whatIf(id: string): Promise<void> {
    try {
      const j = await call<{
        calculation: { name: string };
        inputs: Record<string, unknown>;
      }>(`/api/v1/calculations/${encodeURIComponent(id)}`);
      // Stash for the workbench's mount effect; the workbench will
      // load it WITHOUT a saveContext, so the next Save creates a
      // brand-new calculation row instead of bumping the source's
      // version.
      sessionStorage.setItem("vibecalc.workbench.clone", JSON.stringify(j.inputs));
      toast.success(`Cloning "${j.calculation.name}" — opening fresh workbench.`);
      navigate("/calculators/tvm-workbench");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Saved calculations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open any saved calculation back in the workbench, view its version history, or
          what-if-duplicate it into a new draft.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All calculations</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-destructive">{String((query.error as Error).message)}</p>
          )}
          {query.data && query.data.calculations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No saved calculations yet. Build one in the{" "}
              <Link className="underline" to="/calculators/tvm-workbench">
                TVM workbench
              </Link>{" "}
              or run a tax calculator and save the result.
            </p>
          )}
          {query.data && query.data.calculations.length > 0 && (
            <div className="overflow-x-auto">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {selected.size > 0
                    ? `${selected.size} selected · cap 50 per export`
                    : "Tick rows to bulk-export them."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.size === 0 || exporting}
                  onClick={() => void exportZip()}
                >
                  <FileArchive className="mr-1 h-3 w-3" />
                  {exporting
                    ? "Zipping…"
                    : `Export ${selected.size > 0 ? `${selected.size} ` : ""}as ZIP`}
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={
                          selected.size > 0 && selected.size === query.data.calculations.length
                        }
                        onChange={() => toggleAll(query.data.calculations)}
                        aria-label="Toggle all"
                      />
                    </th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Kind</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">v</th>
                    <th className="px-2 py-2">Updated</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.calculations.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          aria-label={`Select ${c.name}`}
                        />
                      </td>
                      <td className="px-2 py-2 font-medium">{c.name}</td>
                      <td className="px-2 py-2 text-xs">{c.kind}</td>
                      <td className="px-2 py-2 text-xs">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-2 py-2 text-xs">v{c.version}</td>
                      <td className="px-2 py-2 text-xs">
                        {c.updatedAt.slice(0, 19).replace("T", " ")}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="inline-flex gap-1">
                          {c.kind === "tvm" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Open in workbench"
                              onClick={() =>
                                navigate(
                                  `/calculators/tvm-workbench?id=${encodeURIComponent(c.id)}`,
                                )
                              }
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            title="What-if duplicate"
                            onClick={() => void whatIf(c.id)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Versions"
                            onClick={() =>
                              navigate(`/calculations/${encodeURIComponent(c.id)}/versions`)
                            }
                          >
                            <History className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatusBadge({ status }: { status: CalculationRow["status"] }): JSX.Element {
  const tone =
    status === "approved"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "ready_for_review"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{status}</span>;
}
