import { useEffect, useState } from "react";

interface ApiHealth {
  status: string;
  version?: string;
  gitSha?: string;
  dbConnected?: boolean;
  redisConnected?: boolean;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; data: ApiHealth }
  | { kind: "error"; message: string };

export function HealthPage(): JSX.Element {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/health", { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`API responded ${r.status}`);
        }
        return (await r.json()) as ApiHealth;
      })
      .then((data) => {
        setState({ kind: "ok", data });
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const message = err instanceof Error ? err.message : "unknown error";
        setState({ kind: "error", message });
      });
    return () => {
      ac.abort();
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Vibe Calculators</h1>
        <p className="text-sm text-muted-foreground">Self-hosted appliance &mdash; health status</p>
      </header>

      <section
        aria-live="polite"
        className="rounded-md border border-border bg-card p-4 text-card-foreground"
        data-testid="health-card"
      >
        {state.kind === "loading" && (
          <p className="text-sm text-muted-foreground">Checking API health&hellip;</p>
        )}
        {state.kind === "ok" && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium" data-testid="health-status">
              {state.data.status}
            </dd>
            {state.data.version !== undefined && (
              <>
                <dt className="text-muted-foreground">Version</dt>
                <dd>{state.data.version}</dd>
              </>
            )}
            {state.data.gitSha !== undefined && (
              <>
                <dt className="text-muted-foreground">Git SHA</dt>
                <dd className="font-mono text-xs">{state.data.gitSha}</dd>
              </>
            )}
            {state.data.dbConnected !== undefined && (
              <>
                <dt className="text-muted-foreground">Database</dt>
                <dd>{state.data.dbConnected ? "connected" : "disconnected"}</dd>
              </>
            )}
            {state.data.redisConnected !== undefined && (
              <>
                <dt className="text-muted-foreground">Redis</dt>
                <dd>{state.data.redisConnected ? "connected" : "disconnected"}</dd>
              </>
            )}
          </dl>
        )}
        {state.kind === "error" && (
          <p className="text-sm text-destructive" data-testid="health-error">
            Could not reach API: {state.message}
          </p>
        )}
      </section>
    </main>
  );
}
