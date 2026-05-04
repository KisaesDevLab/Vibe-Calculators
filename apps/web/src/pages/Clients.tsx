import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { workspaceApi, type ClientEntityType } from "@/workspace/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Phase 20.1 — Clients index.
 *
 * Searchable / sortable / filterable list with a "New client" wizard
 * inline rather than as a separate route.
 */

const ENTITY_TYPES: { value: ClientEntityType; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "sole_prop", label: "Sole prop" },
  { value: "single_member_llc", label: "Single-member LLC" },
  { value: "multi_member_llc", label: "Multi-member LLC" },
  { value: "s_corp", label: "S-corp" },
  { value: "c_corp", label: "C-corp" },
  { value: "partnership", label: "Partnership" },
  { value: "trust", label: "Trust" },
  { value: "estate", label: "Estate" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
];

export function ClientsPage(): JSX.Element {
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState<string>("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState<"name" | "created" | "updated">("name");
  const [showWizard, setShowWizard] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", "clients", { q: search, entityType, includeArchived, sort }],
    queryFn: () =>
      workspaceApi.listClients({
        q: search || undefined,
        entityType: entityType || undefined,
        includeArchived,
        sort,
      }),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            All firm clients. Use the wizard or cmd-K to navigate.
          </p>
        </div>
        <Button onClick={() => setShowWizard((v) => !v)}>
          {showWizard ? "Cancel" : "New client"}
        </Button>
      </header>

      {showWizard && <NewClientWizard onCreated={() => setShowWizard(false)} />}

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="grow">
          <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            Search
          </label>
          <Input
            data-shortcut="search"
            placeholder="Name or EIN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            Entity type
          </label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            Sort
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="name">Name</option>
            <option value="created">Newest</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Entity type</th>
              <th className="px-3 py-2">EIN</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2 text-right">Status</th>
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
            {!isLoading && data?.clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No matching clients.
                </td>
              </tr>
            )}
            {data?.clients.map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link
                    to={`/clients/${c.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{c.entityType}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.ein ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.archivedAt ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      archived
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function NewClientWizard({ onCreated }: { onCreated: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState<ClientEntityType>("individual");
  const [ein, setEin] = useState("");
  const create = useMutation({
    mutationFn: () =>
      workspaceApi.createClient({
        name,
        entityType,
        ...(ein ? { ein } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace", "clients"] });
      toast.success("Client created");
      onCreated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit(e: FormEvent): void {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>New client</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Entity type
            </label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as ClientEntityType)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              EIN (optional)
            </label>
            <Input
              value={ein}
              onChange={(e) => setEin(e.target.value)}
              placeholder="##-#######"
              pattern="\d{2}-\d{7}"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <Button type="submit" disabled={!name || create.isPending}>
              {create.isPending ? "Creating…" : "Create client"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
