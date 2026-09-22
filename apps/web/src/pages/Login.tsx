import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LoginPanel } from "@kisaesdevlab/vibe-auth/react";
import { ApiError, authApi } from "@/auth/api";
import { useAuth } from "@/auth/AuthContext";
import { BASE_PATH } from "@/lib/base-path";

interface LocationState {
  from?: string;
}

/**
 * `/login` — the local form plus, when single sign-on is enabled, the
 * identity-provider button (driven by GET /auth/status). In `oidc_only`
 * the local form is hidden here and lives on the unlinked `/login/local`
 * route (`breakglass`), where only the break-glass account is accepted.
 */
export function LoginPage({ breakglass = false }: { breakglass?: boolean }): JSX.Element {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoOnly, setSsoOnly] = useState(false);
  const from = (location.state as LocationState | undefined)?.from ?? "/calculators";

  if (!authLoading && isAuthenticated) {
    return <Navigate to="/health" replace />;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login({
        email,
        password,
        ...(totpCode ? { totpCode } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 && /TOTP required/i.test(err.message)) {
          setNeedsTotp(true);
          setError("Enter your authenticator code to continue.");
        } else if (err.status === 403) {
          setError("Local sign-in is disabled. Use single sign-on.");
        } else if (err.status === 429) {
          setError(`Too many attempts. ${err.message}`);
        } else {
          setError("Invalid email or password.");
        }
      } else {
        setError("Network error. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Vibe Calculators — staff portal</p>
      <LoginPanel
        basePath={BASE_PATH}
        // The API redirects the browser here itself, so the path carries the prefix.
        returnTo={`${BASE_PATH}${from}`}
        breakglass={breakglass}
        onStatus={(s) => setSsoOnly(s.mode === "oidc_only")}
        classNames={{
          root: "mt-8",
          button:
            "inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent aria-disabled:opacity-60",
          divider: "my-6 text-center text-xs uppercase tracking-wide text-muted-foreground",
          note: "mt-3 text-center text-xs text-muted-foreground",
        }}
      >
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
          <Field label={breakglass ? "Email or emergency username" : "Email"} htmlFor="email">
            <input
              id="email"
              // The emergency account signs in by username, which type="email" rejects.
              type={breakglass ? "text" : "email"}
              required
              autoComplete={breakglass ? "username" : "email"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          {needsTotp && (
            <Field label="Authenticator code" htmlFor="totp">
              <input
                id="totp"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </LoginPanel>
      {!ssoOnly && !breakglass && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/login/magic" className="underline">
            Use a magic link instead
          </Link>
        </p>
      )}
    </main>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
