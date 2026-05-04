import { useState, type FormEvent } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { workspaceApi, type EngagementType, WorkspaceApiError } from "@/workspace/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/workspace/TagInput";

/**
 * Phase 20.2 — Client detail page.
 *
 * Header with contact + tags, engagements grouped by tax year, and a
 * recent calculations table. Adding an engagement uses an inline
 * form rather than a modal.
 */

export function ClientDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace", "client", id],
    queryFn: () => workspaceApi.getClient(id ?? ""),
    enabled: !!id,
  });

  const archive = useMutation({
    mutationFn: () => workspaceApi.archiveClient(id ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Client archived");
      navigate("/clients");
    },
  });
  const restore = useMutation({
    mutationFn: () => workspaceApi.restoreClient(id ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace", "client", id] });
      toast.success("Client restored");
    },
  });

  if (!id) return <main className="p-8">Missing id</main>;
  if (isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  if (error) {
    const status = error instanceof WorkspaceApiError ? error.status : 0;
    return (
      <main className="p-8 text-sm text-destructive">
        {status === 404 ? "Client not found." : `Error: ${(error as Error).message}`}
      </main>
    );
  }
  if (!data) return <main className="p-8">No data</main>;

  const { client, engagements, recentCalculations, tags } = data;
  const engagementsByYear = groupBy(engagements, (e) => String(e.taxYear ?? "—"));

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 text-xs text-muted-foreground">
        <Link to="/clients" className="hover:underline">
          ← Clients
        </Link>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {client.entityType.replace(/_/g, " ")}{" "}
            {client.ein && (
              <>
                · <span className="font-mono">EIN {client.ein}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {client.archivedAt ? (
            <Button
              variant="secondary"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              Restore
            </Button>
          ) : (
            <Button variant="outline" onClick={() => archive.mutate()} disabled={archive.isPending}>
              Archive
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Engagements</CardTitle>
          </CardHeader>
          <CardContent>
            <NewEngagementForm clientId={client.id} />
            <div className="mt-4 space-y-4">
              {Object.entries(engagementsByYear).map(([year, list]) => (
                <div key={year}>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Tax year {year}
                  </h3>
                  <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                    {list.map((e) => (
                      <li key={e.id} className="flex items-center justify-between p-3">
                        <Link
                          to={`/engagements/${e.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {e.name}
                        </Link>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{e.engagementType.replace(/_/g, " ")}</span>
                          <span className="rounded-full border border-border px-2 py-0.5">
                            {e.status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {engagements.length === 0 && (
                <p className="text-sm text-muted-foreground">No engagements yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagInput entityKind="client" entityId={client.id} attachedTags={tags} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {client.primaryContact.name && <div>{client.primaryContact.name}</div>}
              {client.primaryContact.email && (
                <div className="text-muted-foreground">{client.primaryContact.email}</div>
              )}
              {client.primaryContact.phone && (
                <div className="text-muted-foreground">{client.primaryContact.phone}</div>
              )}
              {!client.primaryContact.name &&
                !client.primaryContact.email &&
                !client.primaryContact.phone && (
                  <p className="text-muted-foreground">No primary contact.</p>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent calculations</CardTitle>
        </CardHeader>
        <CardContent>
          {recentCalculations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calculations yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {recentCalculations.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.kind}</td>
                    <td className="px-3 py-2">{c.status}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(c.updatedAt).toLocaleDateString()}
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

function NewEngagementForm({ clientId }: { clientId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [taxYear, setTaxYear] = useState("");
  const [type, setType] = useState<EngagementType>("advisory");
  const create = useMutation({
    mutationFn: () =>
      workspaceApi.createEngagement({
        clientId,
        name,
        ...(taxYear ? { taxYear: Number(taxYear) } : {}),
        engagementType: type,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace", "client", clientId] });
      toast.success("Engagement created");
      setName("");
      setTaxYear("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (!name) return;
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-12">
      <Input
        className="sm:col-span-6"
        placeholder="New engagement name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        className="sm:col-span-2"
        placeholder="Tax year"
        value={taxYear}
        onChange={(e) => setTaxYear(e.target.value)}
        type="number"
      />
      <select
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm sm:col-span-2"
        value={type}
        onChange={(e) => setType(e.target.value as EngagementType)}
      >
        <option value="advisory">Advisory</option>
        <option value="tax_planning">Planning</option>
        <option value="tax_prep">Prep</option>
        <option value="loan_modeling">Loan modeling</option>
        <option value="audit_support">Audit support</option>
        <option value="other">Other</option>
      </select>
      <Button type="submit" className="sm:col-span-2" disabled={!name || create.isPending}>
        Add
      </Button>
    </form>
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
