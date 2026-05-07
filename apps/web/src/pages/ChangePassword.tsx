import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, authApi } from "@/auth/api";
import { useAuth } from "@/auth/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Phase 25.3 (revised) — forced password change after first sign-in.
 *
 * Reachable when an authenticated user has `mustChangePassword=true`
 * (the only such user out-of-the-box is the seeded default admin).
 * The route gate in <RequireAuth> redirects every other path here
 * until the operator sets a new password; on success we refetch
 * /auth/me, which clears the flag, and bounce to the workspace.
 */
export function ChangePasswordPage(): JSX.Element {
  const { user, isLoading, refetch } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Operators who navigate here directly with a clean account get
  // bounced back to the workspace — the route exists for the forced
  // flow, not voluntary password rotation (use /me for that).
  if (!user.mustChangePassword) return <Navigate to="/me" replace />;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.setPassword({ currentPassword, newPassword });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      refetch();
      navigate("/calculators", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError("Current password is wrong.");
        else if (err.status === 422) setError(err.message);
        else setError(err.message || "Could not change password.");
      } else {
        setError("Network error. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Set a new password</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              You signed in with the install-time default. Pick a new password before continuing.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Current password">
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="current-password"
                />
              </Field>
              <Field label="New password">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  ≥ 12 characters; common-list words rejected.
                </p>
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
              </Field>
              {error && (
                <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
              >
                {submitting ? "Updating…" : "Set password & continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
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
