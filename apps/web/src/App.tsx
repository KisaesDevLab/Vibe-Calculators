import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { RequireAuth, RequirePerm } from "@/auth/guards";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { AppShell } from "@/components/layout/AppShell";
import { CommandPalette, useGlobalShortcuts } from "@/components/layout/CommandPalette";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";

// Eager: small, used on first paint.
import { LoginPage } from "@/pages/Login";
import { MagicLinkPage } from "@/pages/MagicLink";

// Phase 4.6 — route-level code splitting. Each authenticated page is
// split out so the login bundle stays tiny.
const HealthPage = lazy(() => import("@/pages/Health").then((m) => ({ default: m.HealthPage })));
const ProfilePage = lazy(() => import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })));
const AdminUsersPage = lazy(() =>
  import("@/pages/AdminUsers").then((m) => ({ default: m.AdminUsersPage })),
);
const CalculatorsStub = lazy(() =>
  import("@/pages/stubs").then((m) => ({ default: m.CalculatorsStub })),
);
const ClientsStub = lazy(() => import("@/pages/stubs").then((m) => ({ default: m.ClientsStub })));
const EngagementsStub = lazy(() =>
  import("@/pages/stubs").then((m) => ({ default: m.EngagementsStub })),
);
const ReportsStub = lazy(() => import("@/pages/stubs").then((m) => ({ default: m.ReportsStub })));

// Phase 4.7 — TanStack Query defaults per CLAUDE.md.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      // Calculator pages and the like need stable inputs while typing.
      // Other consumers can override per-query.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <ShellShortcuts />
              <CommandPalette />
              <Toaster position="bottom-right" richColors />
              <Routes>
                <Route path="/" element={<Navigate to="/health" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/login/magic" element={<MagicLinkPage />} />
                <Route
                  path="/health"
                  element={
                    <RequireAuth>
                      <Suspense fallback={<RouteSpinner />}>
                        <HealthPage />
                      </Suspense>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/me"
                  element={
                    <RequireAuth>
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <ProfilePage />
                        </Suspense>
                      </ShelledRoute>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/calculators"
                  element={
                    <RequireAuth>
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <CalculatorsStub />
                        </Suspense>
                      </ShelledRoute>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/clients"
                  element={
                    <RequirePerm perm="client:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <ClientsStub />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/engagements"
                  element={
                    <RequirePerm perm="engagement:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <EngagementsStub />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <RequirePerm perm="export:download">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <ReportsStub />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/admin/users"
                  element={
                    <RequirePerm perm="user:list">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminUsersPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function ShelledRoute({ children }: { children: React.ReactNode }): JSX.Element {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <></>;
  return <AppShell>{children}</AppShell>;
}

function ShellShortcuts(): JSX.Element {
  // Hook is called inside Router so it can use useNavigate.
  useGlobalShortcuts();
  // Avoid re-running on location change beyond what the hook does.
  void useLocation();
  return <></>;
}

function RouteSpinner(): JSX.Element {
  return (
    <main className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </main>
  );
}
