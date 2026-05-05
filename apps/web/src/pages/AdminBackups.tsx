import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, AlertTriangle, RotateCw, Terminal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Phase 25.8 — restore wizard.
 *
 * Lists snapshots in /data/backups (server reads via the backups
 * volume, ro). To restore: select a snapshot, type
 * `DESTRUCTIVE-REPLACE`, confirm. The API records an audit event
 * and returns the operator-side `vibecalc-installer restore <path>`
 * command — the actual destructive replace runs from the host so
 * the read-only API container never has to touch pg_restore.
 */

interface BackupSummary {
  name: string;
  createdAt: string | null;
  sizeBytes: number;
  manifest: Record<string, unknown> | null;
  files: { pgdump: boolean; pdfOutput: boolean; checksums: boolean };
}

interface BackupsResponse {
  backupsDir: string;
  backups: BackupSummary[];
}

interface RestoreResponse {
  ok: boolean;
  message: string;
  command: string;
}

const REQUIRED = "DESTRUCTIVE-REPLACE";

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

export function AdminBackupsPage(): JSX.Element {
  const list = useQuery({
    queryKey: ["admin", "backups"],
    queryFn: () => call<BackupsResponse>("/api/v1/admin/backups"),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<RestoreResponse | null>(null);

  const restore = useMutation({
    mutationFn: (vars: { name: string; confirmation: string }) =>
      call<RestoreResponse>(`/api/v1/admin/backups/${vars.name}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirmation: vars.confirmation }),
      }),
    onSuccess: (data) => {
      setResult(data);
      toast.success("Restore intent recorded — run the command on the host to apply.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const selectedBackup = list.data?.backups.find((b) => b.name === selected) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Archive className="h-5 w-5 text-primary" /> Backups & restore
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Snapshots are written by{" "}
            <code className="rounded bg-muted px-1 text-xs">vibecalc-installer backup</code> (or{" "}
            <code className="rounded bg-muted px-1 text-xs">just backup</code>) into the backups
            volume. To restore, select a snapshot, type{" "}
            <code className="rounded bg-muted px-1 text-xs">{REQUIRED}</code>, and run the generated
            command from the host shell.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => list.refetch()}>
          <RotateCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Available snapshots</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {list.isError && (
            <p className="text-sm text-destructive">{(list.error as Error).message}</p>
          )}
          {list.data && list.data.backups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No snapshots in <code>{list.data.backupsDir}</code>. Run{" "}
              <code>vibecalc-installer backup</code> on the host to create one.
            </p>
          )}
          {list.data && list.data.backups.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5"></th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Created</th>
                  <th className="px-2 py-1.5 text-right">Size</th>
                  <th className="px-2 py-1.5">Files</th>
                </tr>
              </thead>
              <tbody>
                {list.data.backups.map((b) => (
                  <tr key={b.name} className="border-b last:border-b-0">
                    <td className="px-2 py-1.5">
                      <input
                        type="radio"
                        checked={selected === b.name}
                        onChange={() => {
                          setSelected(b.name);
                          setResult(null);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">{b.name}</td>
                    <td className="px-2 py-1.5">
                      {b.createdAt ? new Date(b.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right">{humanBytes(b.sizeBytes)}</td>
                    <td className="px-2 py-1.5">
                      <FilePill ok={b.files.pgdump}>pg</FilePill>{" "}
                      <FilePill ok={b.files.pdfOutput}>tgz</FilePill>{" "}
                      <FilePill ok={b.files.checksums}>sha256</FilePill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {selectedBackup && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" /> Restore wizard
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Selected: <code className="rounded bg-muted px-1 text-xs">{selectedBackup.name}</code>
              . Restoring overwrites the live database and all uploaded files. Active sessions will
              be invalidated. This action cannot be undone.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Type {REQUIRED} to confirm
              </span>
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={REQUIRED}
              />
            </label>
            <div>
              <Button
                variant="destructive"
                disabled={confirmation !== REQUIRED || restore.isPending}
                onClick={() => restore.mutate({ name: selectedBackup.name, confirmation })}
              >
                {restore.isPending ? "Recording…" : "Confirm restore intent"}
              </Button>
            </div>
            {result && (
              <div className="rounded-md border border-input bg-muted/30 p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Terminal className="h-4 w-4" /> Run this command on the host:
                </p>
                <pre className="overflow-x-auto rounded bg-background px-3 py-2 text-xs font-mono">
                  {result.command}
                </pre>
                <p className="mt-2 text-xs text-muted-foreground">
                  The restore replaces the live DB and exports volume. The audit trail records this
                  intent before the command runs, tying the wizard confirmation to the
                  filesystem-level operation.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function FilePill({ ok, children }: { ok: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <span
      className={
        "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase " +
        (ok
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground line-through")
      }
    >
      {children}
    </span>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
