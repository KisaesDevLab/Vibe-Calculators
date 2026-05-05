import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, authApi } from "@/auth/api";

/**
 * Phase 2.13 — magic-link UI.
 *
 * Two modes:
 *   - With ?token=...   → consume immediately
 *   - Without           → show a form to request a magic link
 */

export function MagicLinkPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get("token");
  if (token) return <ConsumeView token={token} />;
  return <RequestView />;
}

function RequestView(): JSX.Element {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authApi.requestMagicLink(email);
      setSubmitted(true);
    } catch {
      setError("Could not request a magic link. Try again later.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If <strong>{email}</strong> matches an active account, a sign-in link has been sent. Links
          expire in 15 minutes and work only once.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in via email</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your work email and we'll send a one-time sign-in link.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label htmlFor="email" className="block">
          <span className="block text-sm font-medium text-foreground">Email</span>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send magic link"}
        </button>
      </form>
    </main>
  );
}

function ConsumeView({ token }: { token: string }): JSX.Element {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string>("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        await authApi.consumeMagicLink(token);
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        setState("ok");
        navigate("/calculators", { replace: true });
      } catch (err) {
        setState("error");
        setError(err instanceof ApiError ? err.message : "Unknown error");
      }
    })();
  }, [token, navigate, queryClient]);

  if (state === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Signing you in…
      </main>
    );
  }
  if (state === "error") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Magic link is invalid</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <p className="mt-4 text-sm">
          <a href="/login/magic" className="underline">
            Request a new link
          </a>
        </p>
      </main>
    );
  }
  return <></>;
}
