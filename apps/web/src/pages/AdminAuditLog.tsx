import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminApi, type AuditEventRow } from "@/admin/api";

/**
 * Phase 21 — audit-log viewer + tamper-chain validator.
 *
 * Each row's hash includes the previous row's hash; a tampered row
 * breaks the chain. The validator endpoint walks the table and
 * surfaces the first row whose hash doesn't match its content.
 */

export function AdminAuditLogPage(): JSX.Element {
  const [actionFilter, setActionFilter] = useState("");
  const [limit, setLimit] = useState("100");

  const query = useQuery({
    queryKey: ["admin", "audit", actionFilter, limit],
    queryFn: () =>
      adminApi.listAuditEvents({
        ...(actionFilter ? { action: actionFilter } : {}),
        limit: Number(limit) || 100,
      }),
  });

  const [chainResult, setChainResult] = useState<{
    valid: boolean;
    checked: number;
    firstBadId: string | null;
  } | null>(null);
  const [validating, setValidating] = useState(false);

  async function validate(): Promise<void> {
    setValidating(true);
    try {
      setChainResult(await adminApi.validateAuditChain());
    } finally {
      setValidating(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Insert-only, hash-chained record of every domain mutation. Each row's hash includes the
          previous row's hash; tampering with any row breaks the chain.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Hash-chain validator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Button onClick={validate} disabled={validating}>
              {validating ? "Validating…" : "Validate chain"}
            </Button>
            {chainResult && (
              <div className="flex items-center gap-2 text-sm">
                {chainResult.valid ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span>
                      Chain intact — {chainResult.checked.toLocaleString()} rows verified.
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">
                      Tamper detected at row{" "}
                      <code className="rounded bg-muted px-1 text-xs">
                        {chainResult.firstBadId}
                      </code>{" "}
                      after {chainResult.checked.toLocaleString()} clean rows.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Action filter (e.g. calculation.approve)
              </span>
              <Input
                placeholder="leave empty for all"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Limit
              </span>
              <Input
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
          </div>
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-destructive">{String((query.error as Error).message)}</p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No events match the current filter.</p>
          )}
          {query.data && query.data.length > 0 && <EventTable rows={query.data} />}
        </CardContent>
      </Card>
    </main>
  );
}

function EventTable({ rows }: { rows: AuditEventRow[] }): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-2">When</th>
            <th className="px-2 py-2">Action</th>
            <th className="px-2 py-2">Entity</th>
            <th className="px-2 py-2">Actor</th>
            <th className="px-2 py-2">Hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr
                className="cursor-pointer border-b hover:bg-muted/40"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <td className="px-2 py-2 text-xs">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                <td className="px-2 py-2 text-xs font-medium">{r.action}</td>
                <td className="px-2 py-2 text-xs">
                  {r.entityKind ? `${r.entityKind}/${(r.entityId ?? "").slice(0, 8)}…` : "—"}
                </td>
                <td className="px-2 py-2 text-xs">{r.actorId?.slice(0, 8) ?? "system"}…</td>
                <td className="px-2 py-2 font-mono text-xs">{r.rowHash.slice(0, 12)}…</td>
              </tr>
              {expandedId === r.id && (
                <tr className="border-b">
                  <td colSpan={5} className="bg-muted/30 px-3 py-3">
                    <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
