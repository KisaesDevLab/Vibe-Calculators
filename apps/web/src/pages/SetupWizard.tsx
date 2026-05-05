import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Phase 25.1 — first-run setup wizard.
 *
 * Visible only when the appliance has zero users. Walks the operator
 * through:
 *   1. Paste the bootstrap token printed by `just bootstrap`
 *   2. Set the first admin's email + name + password
 *   3. Confirm
 *
 * On success, the new admin is logged in and routed to /clients.
 */

interface SetupStatus {
  open: boolean;
}

export function SetupWizardPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/setup/status", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((raw) => {
        if (cancelled) return;
        // Validate the response shape — opening the wizard on a
        // transient parser hiccup would let an attacker race a fresh
        // setup attempt against a live deploy.
        if (
          raw &&
          typeof raw === "object" &&
          typeof (raw as { open?: unknown }).open === "boolean"
        ) {
          const j = raw as SetupStatus;
          setStatus(j);
          if (!j.open) navigate("/login", { replace: true });
        } else {
          navigate("/login", { replace: true });
        }
      })
      .catch(() => {
        // Network / 4xx / 5xx — fall through to /login. The wizard
        // only opens when we have a confirmed `{ open: true }` response.
        if (!cancelled) navigate("/login", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/setup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, name, password }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { detail?: string };
        throw new Error(j.detail ?? `HTTP ${res.status}`);
      }
      // Setup created a session cookie, but the AuthProvider's
      // `["auth", "me"]` query was populated with `null` at app boot
      // (no session existed then). Without invalidating, RequirePerm
      // would read the stale null, bounce to /login, the login page
      // would refetch and see us logged in, and finally redirect to
      // its default landing — making setup appear to land somewhere
      // unintended. Force a refetch and wait so the next route lookup
      // sees the new identity.
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.refetchQueries({ queryKey: ["auth", "me"] });
      navigate("/clients", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to Vibe Calculators</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            First-run setup. Paste the bootstrap token from{" "}
            <code className="rounded bg-muted px-1">just bootstrap</code> and create the first admin
            user.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Bootstrap token">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoFocus
                placeholder="vibe_setup_…"
                autoComplete="off"
              />
            </Field>
            <Field label="Admin email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field label="Admin name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                ≥ 12 characters; reject common-list words. zxcvbn-ts grades the strength
                server-side.
              </p>
            </Field>
            {error && (
              <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting || !token || !email || !name || !password}>
              {submitting ? "Creating…" : "Create admin & log in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
