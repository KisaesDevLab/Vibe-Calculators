import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, authApi } from "@/auth/api";
import { useAuth } from "@/auth/AuthContext";

interface LocationState {
  from?: string;
}

export function LoginPage(): JSX.Element {
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
      const target = (location.state as LocationState | undefined)?.from ?? "/calculators";
      navigate(target, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 && /TOTP required/i.test(err.message)) {
          setNeedsTotp(true);
          setError("Enter your authenticator code to continue.");
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
      <form onSubmit={handleSubmit} className="mt-8 space-y-4" data-testid="login-form">
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
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
      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link to="/login/magic" className="underline">
          Use a magic link instead
        </Link>
      </p>
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
