import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminApi, type WebhookRow } from "@/admin/api";

/**
 * Phase 24.3 — webhook admin page.
 *
 * The signing secret is shown ONCE at creation; after that the secret
 * lives KMS-sealed in the DB. The dispatcher unseals at send time.
 */

const COMMON_ACTIONS = [
  "calculation.create",
  "calculation.approve",
  "calculation.archive",
  "engagement.transition",
  "export.created",
  "audit.high_risk",
];

export function AdminWebhooksPage(): JSX.Element {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "webhooks"],
    queryFn: () => adminApi.listWebhooks(),
  });
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{
    secret: string;
    webhook: WebhookRow;
  } | null>(null);

  async function create(): Promise<void> {
    if (!name.trim() || !url.trim()) {
      toast.error("Name and URL are required");
      return;
    }
    setCreating(true);
    try {
      const result = await adminApi.createWebhook({
        name: name.trim(),
        url: url.trim(),
        actions,
      });
      setCreatedSecret(result);
      setName("");
      setUrl("");
      setActions([]);
      await queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm("Archive this webhook? Outbound deliveries stop immediately.")) return;
    try {
      await adminApi.deleteWebhook(id);
      toast.success("Webhook archived");
      await queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outbound HMAC-signed event deliveries. Each event includes header{" "}
          <code className="rounded bg-muted px-1 text-xs">X-Vibe-Signature</code> in Stripe-style{" "}
          <code className="rounded bg-muted px-1 text-xs">t=&lt;unix&gt;,v1=&lt;hex&gt;</code>{" "}
          format.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Subscribe</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Label
              </span>
              <Input
                placeholder="e.g. ops-slack"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                URL (must be https)
              </span>
              <Input
                placeholder="https://hooks.firm.example/vibe"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3">
            <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Actions (empty = all)
            </span>
            <div className="flex flex-wrap gap-2">
              {COMMON_ACTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={
                    "rounded-full border px-2 py-0.5 text-xs " +
                    (actions.includes(a)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted-foreground hover:border-primary/40")
                  }
                  onClick={() =>
                    setActions((prev) =>
                      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
                    )
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={create} disabled={creating}>
              <Plus className="mr-1 h-4 w-4" />
              {creating ? "Subscribing…" : "Subscribe"}
            </Button>
          </div>
          {createdSecret && (
            <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2">
              <p className="mb-2 text-xs font-medium uppercase text-amber-700 dark:text-amber-400">
                Signing secret — copy now, you won't see it again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 text-xs">
                  {createdSecret.secret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdSecret.secret);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setCreatedSecret(null)}
              >
                Dismiss
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-destructive">{String((query.error as Error).message)}</p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
          )}
          {query.data && query.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">URL</th>
                    <th className="px-2 py-2">Actions</th>
                    <th className="px-2 py-2">Last fired</th>
                    <th className="px-2 py-2">Last error</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((w) => (
                    <tr key={w.id} className="border-b">
                      <td className="px-2 py-2 font-medium">{w.name}</td>
                      <td className="px-2 py-2 break-all text-xs font-mono">{w.url}</td>
                      <td className="px-2 py-2 text-xs">
                        {w.actions.length > 0 ? w.actions.join(", ") : <em>all</em>}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {w.lastFiredAt ? w.lastFiredAt.slice(0, 19).replace("T", " ") : "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-destructive">
                        {w.lastFailureMessage ?? ""}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => void remove(w.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
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
