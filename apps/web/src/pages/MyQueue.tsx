import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { workspaceApi } from "@/workspace/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Phase 20.6 — "My queue" dashboard.
 *
 * Engagements assigned to the requester. SLA flag highlights items
 * that have been "in review" for more than slaThresholdDays days.
 */

export function MyQueuePage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ["workspace", "queue"],
    queryFn: () => workspaceApi.myQueue(),
    staleTime: 30_000,
  });

  if (isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  if (!data) return <main className="p-8">No data</main>;

  const inReviewSlow = data.myEngagements.filter((e) => e.slaFlagged);
  const draft = data.myEngagements.filter((e) => e.status === "draft");
  const approved = data.myEngagements.filter((e) => e.status === "approved");
  const inReview = data.myEngagements.filter((e) => e.status === "in_review");

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My queue</h1>
        <p className="text-sm text-muted-foreground">
          Items assigned to you. Engagements in review for &gt; {data.slaThresholdDays} days are
          flagged.
        </p>
      </header>

      {inReviewSlow.length > 0 && (
        <Card className="mt-4 border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">SLA — needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {inReviewSlow.map((e) => (
                <li key={e.id} className="flex items-center justify-between text-sm">
                  <Link to={`/engagements/${e.id}`} className="text-primary hover:underline">
                    {e.name}
                  </Link>
                  <span className="text-xs text-destructive">{e.daysSinceUpdate} days idle</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <QueueColumn title="Drafts" items={draft} />
        <QueueColumn title="In review" items={inReview} />
        <QueueColumn title="Approved" items={approved} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Calculations awaiting your review</CardTitle>
        </CardHeader>
        <CardContent>
          {data.pendingReviewCalculations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <ul className="space-y-2">
              {data.pendingReviewCalculations.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <Link
                    to={c.engagementId ? `/engagements/${c.engagementId}` : "#"}
                    className="text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{c.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function QueueColumn({
  title,
  items,
}: {
  title: string;
  items: { id: string; name: string; updatedAt: string; taxYear: number | null }[];
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} <span className="text-muted-foreground">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Empty.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((e) => (
              <li key={e.id}>
                <Link to={`/engagements/${e.id}`} className="hover:underline">
                  {e.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {e.taxYear ?? "—"} · updated {new Date(e.updatedAt).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
