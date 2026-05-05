import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { Permission } from "@vibe-calc/shared-types";
import { useAuth } from "./AuthContext";

/**
 * Phase 2.13 — route guards.
 *
 * <RequireAuth>: redirects to /login (preserving the intended target
 * via state) when no user is loaded.
 *
 * <RequirePerm perm="X">: shows the children only when the user holds
 * the named permission. Falls through to a 403 panel otherwise. Per
 * CLAUDE.md these guards are the ONLY way auth-aware UI gates work
 * client-side; raw `if (user.role === 'admin')` checks are forbidden.
 */

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullScreenSpinner label="Loading session…" />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

export function RequirePerm({
  perm,
  children,
}: {
  perm: Permission;
  children: ReactNode;
}): JSX.Element {
  const { hasPermission, isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullScreenSpinner label="Loading session…" />;
  if (!isAuthenticated) {
    // Preserve the intended target so the post-login redirect lands
    // back here rather than the default /health page.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!hasPermission(perm)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account does not have permission to view this page.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Required: {perm}</p>
      </main>
    );
  }
  return <>{children}</>;
}

function FullScreenSpinner({ label }: { label: string }): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      {label}
    </main>
  );
}
