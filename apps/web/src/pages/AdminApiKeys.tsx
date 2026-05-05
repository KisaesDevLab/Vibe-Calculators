import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plus, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminApi, type ApiKeyRow } from "@/admin/api";

/**
 * Phase 24.2 — API key admin page.
 *
 * Plaintext token is shown ONCE on creation; after that only the
 * prefix is visible. Revoke is irreversible.
 */

export function AdminApiKeysPage(): JSX.Element {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "api-keys"],
    queryFn: () => adminApi.listApiKeys(),
  });
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("365");
  const [creating, setCreating] = useState(false);
  const [createdPlaintext, setCreatedPlaintext] = useState<{
    plaintext: string;
    apiKey: ApiKeyRow;
  } | null>(null);

  async function create(): Promise<void> {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setCreating(true);
    try {
      const result = await adminApi.createApiKey({
        name: name.trim(),
        ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
      });
      setCreatedPlaintext(result);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    if (!confirm("Revoke this key? Apps using it will start getting 401s immediately.")) return;
    try {
      await adminApi.revokeApiKey(id);
      toast.success("Key revoked");
      await queryClient.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-user, scoped tokens for the public REST API. Plaintext is shown once at creation —
          paste it into your client now or reissue.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Issue a new key</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Label
              </span>
              <Input
                placeholder="e.g. zapier-import"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Expires in (days)
              </span>
              <Input
                type="number"
                min={1}
                max={3650}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
            </label>
            <div className="flex items-end">
              <Button onClick={create} disabled={creating}>
                <Plus className="mr-1 h-4 w-4" />
                {creating ? "Issuing…" : "Issue key"}
              </Button>
            </div>
          </div>
          {createdPlaintext && (
            <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2">
              <p className="mb-2 text-xs font-medium uppercase text-amber-700 dark:text-amber-400">
                Copy this token now — you won't see it again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 text-xs">
                  {createdPlaintext.plaintext}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdPlaintext.plaintext);
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
                onClick={() => setCreatedPlaintext(null)}
              >
                Dismiss
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All keys</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-destructive">{String((query.error as Error).message)}</p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No keys issued yet.</p>
          )}
          {query.data && query.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Prefix</th>
                    <th className="px-2 py-2">Scopes</th>
                    <th className="px-2 py-2">Created</th>
                    <th className="px-2 py-2">Expires</th>
                    <th className="px-2 py-2">Last used</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((k) => (
                    <tr key={k.id} className="border-b">
                      <td className="px-2 py-2 font-medium">{k.name}</td>
                      <td className="px-2 py-2 font-mono text-xs">{k.prefix}…</td>
                      <td className="px-2 py-2 text-xs">{k.scopes.join(", ") || "—"}</td>
                      <td className="px-2 py-2 text-xs">{k.createdAt.slice(0, 10)}</td>
                      <td className="px-2 py-2 text-xs">{k.expiresAt?.slice(0, 10) ?? "never"}</td>
                      <td className="px-2 py-2 text-xs">
                        {k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {k.revokedAt ? (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                            revoked
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                            active
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {!k.revokedAt && (
                          <Button variant="ghost" size="sm" onClick={() => void revoke(k.id)}>
                            <Ban className="h-3 w-3" />
                          </Button>
                        )}
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
