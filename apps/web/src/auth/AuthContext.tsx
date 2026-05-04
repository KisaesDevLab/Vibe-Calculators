import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Permission } from "@vibe-calc/shared-types";
import { authApi, type AuthUser } from "./api";

/**
 * Phase 2.13 — auth context + useAuth hook.
 *
 * The context holds the current-session resolution from
 * GET /api/v1/auth/me. TanStack Query owns the cache;
 * <RequireAuth> / <RequirePerm> read it.
 */

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasPermission: (perm: Permission) => boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authApi.me(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const user = query.data?.user ?? null;
  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoading: query.isLoading,
      isAuthenticated: user !== null,
      hasPermission: (perm) => user?.permissions.includes(perm) ?? false,
      refetch: () => {
        void query.refetch();
      },
    }),
    [user, query.isLoading, query.refetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
