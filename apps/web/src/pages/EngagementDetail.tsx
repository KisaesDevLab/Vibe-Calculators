import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { workspaceApi, type EngagementStatus, WorkspaceApiError } from "@/workspace/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/workspace/TagInput";
import { useAuth } from "@/auth/AuthContext";

/**
 * Phase 20.3 — Engagement detail.
 *
 * Status workflow buttons drive the (draft → in_review → approved →
 * closed) transitions enforced server-side. Calculations grouped by
 * kind. Bulk-archive selection across calculations.
 */

const NEXT_TRANSITIONS: Record<EngagementStatus, readonly EngagementStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["closed", "in_review"],
  closed: [],
};

export function EngagementDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [selectedCalcIds, setSelectedCalcIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace", "engagement", id],
    queryFn: () => workspaceApi.getEngagement(id ?? ""),
    enabled: !!id,
  });

  const transition = useMutation({
    mutationFn: (to: EngagementStatus) => workspaceApi.transitionEngagement(id ?? "", to),
    onSuccess: (out) => {
      void queryClient.invalidateQueries({ queryKey: ["workspace", "engagement", id] });
      toast.success(`Status → ${out.engagement.status}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkArchive = useMutation({
    mutationFn: (ids: string[]) => workspaceApi.bulkArchiveCalcs(ids),
    onSuccess: (out) => {
      void queryClient.invalidateQueries({ queryKey: ["workspace", "engagement", id] });
      toast.success(`Archived ${out.updatedIds.length} calculation(s)`);
      setSelectedCalcIds(new Set());
    },
  });

  if (!id) return <main className="p-8">Missing id</main>;
  if (isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  if (error) {
    const status = error instanceof WorkspaceApiError ? error.status : 0;
    return (
      <main className="p-8 text-sm text-destructive">
        {status === 404 ? "Engagement not found." : `Error: ${(error as Error).message}`}
      </main>
    );
  }
  if (!data) return <main className="p-8">No data</main>;

  const { engagement, calculations, tags } = data;
  const calcsByKind = groupBy(calculations, (c) => c.kind);
  const allowedNext = NEXT_TRANSITIONS[engagement.status];

  function toggleSelect(id: string): void {
    setSelectedCalcIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 text-xs text-muted-foreground">
        <Link to={`/clients/${engagement.clientId}`} className="hover:underline">
          ← Client
        </Link>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{engagement.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {engagement.engagementType.replace(/_/g, " ")}
            {engagement.taxYear && ` · ${engagement.taxYear}`}
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs">
              {engagement.status}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          {allowedNext.map((to) => (
            <Button
              key={to}
              variant={to === "approved" ? "default" : "outline"}
              disabled={
                (to === "approved" && !hasPermission("calculation:approve")) || transition.isPending
              }
              onClick={() => transition.mutate(to)}
            >
              {to === "in_review"
                ? "Submit for review"
                : to === "approved"
                  ? "Approve"
                  : to === "closed"
                    ? "Close"
                    : `→ ${to}`}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Calculations</CardTitle>
              {selectedCalcIds.size > 0 && hasPermission("calculation:archive") && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {selectedCalcIds.size} selected
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => bulkArchive.mutate([...selectedCalcIds])}
                    disabled={bulkArchive.isPending}
                  >
                    Bulk archive
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {calculations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No calculations yet. Open the workbench to create one.
              </p>
            )}
            {Object.entries(calcsByKind).map(([kind, list]) => (
              <div key={kind} className="mb-4 last:mb-0">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">{kind}</h3>
                <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 p-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedCalcIds.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                        />
                        <div>
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            v{c.version} · {c.status} · updated{" "}
                            {new Date(c.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Assignments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Preparer:</span>{" "}
                {engagement.assignedPreparerId ?? <span className="italic">unassigned</span>}
              </div>
              <div>
                <span className="text-muted-foreground">Reviewer:</span>{" "}
                {engagement.assignedReviewerId ?? <span className="italic">unassigned</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Use the assignment endpoint or the bulk-actions panel to reassign.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagInput entityKind="engagement" entityId={engagement.id} attachedTags={tags} />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (out[k] = out[k] ?? []).push(item);
  }
  return out;
}
