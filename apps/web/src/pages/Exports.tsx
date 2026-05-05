import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, RotateCw, X, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Phase 13.7 — async exports list page.
 *
 * Polls /api/v1/exports every 3s for jobs in queued/processing
 * status; refresh stops once everything is in a terminal state.
 * Operators kick off exports from per-calculation pages (which POST
 * to /api/v1/exports); this page is the inbox where the resulting
 * files appear when ready.
 */

interface ExportJob {
  id: string;
  kind: "tvm-pdf" | "memo-pdf" | "xlsx" | "csv" | "docx" | "bulk-zip";
  status: "queued" | "processing" | "done" | "failed";
  calculationId: string | null;
  calculationIds: string[];
  filename: string | null;
  sizeBytes: number | null;
  progress: number;
  errorMessage: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
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

export function ExportsPage(): JSX.Element {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["exports", "mine"],
    queryFn: () => call<{ exportJobs: ExportJob[] }>("/api/v1/exports"),
    refetchInterval: (data) => {
      const jobs = (data?.state.data as { exportJobs: ExportJob[] } | undefined)?.exportJobs ?? [];
      return jobs.some((j) => j.status === "queued" || j.status === "processing") ? 3000 : false;
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) =>
      call<{ exportJob: ExportJob | null }>(`/api/v1/exports/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["exports", "mine"] });
      toast.success("Job cancelled");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Download className="h-5 w-5 text-primary" /> Exports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Files queued for asynchronous rendering. Done jobs are retained for 30 days, then
            unlinked by the retention sweep.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => list.refetch()}>
          <RotateCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {list.isError && (
            <p className="text-sm text-destructive">{(list.error as Error).message}</p>
          )}
          {list.data && list.data.exportJobs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No export jobs yet. Queue one from a calculation's export menu.
            </p>
          )}
          {list.data && list.data.exportJobs.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Kind</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Filename</th>
                  <th className="px-2 py-1.5 text-right">Size</th>
                  <th className="px-2 py-1.5">Requested</th>
                  <th className="px-2 py-1.5">Expires</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {list.data.exportJobs.map((j) => (
                  <tr key={j.id} className="border-b last:border-b-0">
                    <td className="px-2 py-1.5">
                      <code className="rounded bg-muted px-1 text-xs">{j.kind}</code>
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={j.status} progress={j.progress} />
                      {j.errorMessage && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-destructive">
                          <FileWarning className="h-3 w-3" /> {j.errorMessage}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{j.filename ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {j.sizeBytes ? humanBytes(j.sizeBytes) : "—"}
                    </td>
                    <td className="px-2 py-1.5">{formatDate(j.requestedAt)}</td>
                    <td className="px-2 py-1.5">{j.expiresAt ? formatDate(j.expiresAt) : "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {j.status === "done" && j.filename && (
                        <a
                          href={`/api/v1/exports/${j.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm" variant="outline">
                            <Download className="mr-1 h-3 w-3" /> Download
                          </Button>
                        </a>
                      )}
                      {(j.status === "queued" || j.status === "processing") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cancel.mutate(j.id)}
                          disabled={cancel.isPending}
                        >
                          <X className="mr-1 h-3 w-3" /> Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatusPill({
  status,
  progress,
}: {
  status: ExportJob["status"];
  progress: number;
}): JSX.Element {
  if (status === "queued") {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        Queued
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Processing {progress > 0 ? `${progress}%` : ""}
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
        Done
      </span>
    );
  }
  return (
    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
      Failed
    </span>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
