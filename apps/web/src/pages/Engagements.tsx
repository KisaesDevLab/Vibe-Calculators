import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { workspaceApi, type EngagementStatus } from "@/workspace/api";
import { Input } from "@/components/ui/input";

/**
 * Phase 20.3 — Engagements list (cross-client).
 *
 * Useful when a CPA wants the firm-wide queue rather than drilling
 * through one client at a time.
 */

export function EngagementsPage(): JSX.Element {
  const [taxYear, setTaxYear] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const params: { taxYear?: number; status?: EngagementStatus } = {};
  if (taxYear) params.taxYear = Number(taxYear);
  if (status) params.status = status as EngagementStatus;
  const { data, isLoading } = useQuery({
    queryKey: ["workspace", "engagements", { taxYear, status }],
    queryFn: () => workspaceApi.listEngagements(params),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Engagements</h1>
        <p className="text-sm text-muted-foreground">
          Firm-wide engagements across clients. Open one to see calculations and run the status
          workflow.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            Tax year
          </label>
          <Input
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value)}
            placeholder="2025"
            type="number"
            className="w-28"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="approved">Approved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Engagement</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Tax year</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && data?.engagements.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No engagements match these filters.
                </td>
              </tr>
            )}
            {data?.engagements.map((e) => (
              <tr key={e.id} className="border-t border-border hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link
                    to={`/engagements/${e.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{e.engagementType.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">{e.taxYear ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {e.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(e.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
