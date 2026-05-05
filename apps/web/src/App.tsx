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
import { SetupWizardPage } from "@/pages/SetupWizard";

// Phase 4.6 — route-level code splitting. Each authenticated page is
// split out so the login bundle stays tiny.
const HealthPage = lazy(() => import("@/pages/Health").then((m) => ({ default: m.HealthPage })));
const ProfilePage = lazy(() => import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })));
const AdminUsersPage = lazy(() =>
  import("@/pages/AdminUsers").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminApiKeysPage = lazy(() =>
  import("@/pages/AdminApiKeys").then((m) => ({ default: m.AdminApiKeysPage })),
);
const AdminWebhooksPage = lazy(() =>
  import("@/pages/AdminWebhooks").then((m) => ({ default: m.AdminWebhooksPage })),
);
const AdminAuditLogPage = lazy(() =>
  import("@/pages/AdminAuditLog").then((m) => ({ default: m.AdminAuditLogPage })),
);
const AdminAiPage = lazy(() => import("@/pages/AdminAi").then((m) => ({ default: m.AdminAiPage })));
const AdminFirmSettingsPage = lazy(() =>
  import("@/pages/AdminFirmSettings").then((m) => ({ default: m.AdminFirmSettingsPage })),
);
const AdminAiPromptsPage = lazy(() =>
  import("@/pages/AdminAiPrompts").then((m) => ({ default: m.AdminAiPromptsPage })),
);
const WorkbenchPage = lazy(() =>
  import("@/pages/Workbench").then((m) => ({ default: m.WorkbenchPage })),
);
const CalculatorsPage = lazy(() =>
  import("@/pages/Calculators").then((m) => ({ default: m.CalculatorsPage })),
);
const CalculatorRunnerPage = lazy(() =>
  import("@/pages/CalculatorRunner").then((m) => ({ default: m.CalculatorRunnerPage })),
);
const ExtractPage = lazy(() => import("@/pages/Extract").then((m) => ({ default: m.ExtractPage })));
const CalculationVersionsPage = lazy(() =>
  import("@/pages/CalculationVersions").then((m) => ({ default: m.CalculationVersionsPage })),
);
const CalculationsIndexPage = lazy(() =>
  import("@/pages/CalculationsIndex").then((m) => ({ default: m.CalculationsIndexPage })),
);
const ClientsPage = lazy(() => import("@/pages/Clients").then((m) => ({ default: m.ClientsPage })));
const ClientDetailPage = lazy(() =>
  import("@/pages/ClientDetail").then((m) => ({ default: m.ClientDetailPage })),
);
const EngagementsPage = lazy(() =>
  import("@/pages/Engagements").then((m) => ({ default: m.EngagementsPage })),
);
const EngagementDetailPage = lazy(() =>
  import("@/pages/EngagementDetail").then((m) => ({ default: m.EngagementDetailPage })),
);
const MyQueuePage = lazy(() => import("@/pages/MyQueue").then((m) => ({ default: m.MyQueuePage })));
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
                <Route path="/setup" element={<SetupWizardPage />} />
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
                          <CalculatorsPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/calculators/tvm-workbench"
                  element={
                    <RequireAuth>
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <WorkbenchPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequireAuth>
                  }
                />
                <Route
                  path="/calculators/:kind"
                  element={
                    <RequireAuth>
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <CalculatorRunnerPage />
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
                          <ClientsPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/clients/:id"
                  element={
                    <RequirePerm perm="client:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <ClientDetailPage />
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
                          <EngagementsPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/engagements/:id"
                  element={
                    <RequirePerm perm="engagement:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <EngagementDetailPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/queue"
                  element={
                    <RequirePerm perm="engagement:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <MyQueuePage />
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
                  path="/calculations"
                  element={
                    <RequirePerm perm="calculation:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <CalculationsIndexPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/calculations/:id/versions"
                  element={
                    <RequirePerm perm="calculation:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <CalculationVersionsPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/extract"
                  element={
                    <RequirePerm perm="ai:use">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <ExtractPage />
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
                <Route
                  path="/admin/api-keys"
                  element={
                    <RequirePerm perm="user:list">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminApiKeysPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/admin/webhooks"
                  element={
                    <RequirePerm perm="user:list">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminWebhooksPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/admin/audit"
                  element={
                    <RequirePerm perm="audit:read">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminAuditLogPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/admin/ai"
                  element={
                    <RequirePerm perm="user:list">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminAiPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/admin/firm-settings"
                  element={
                    <RequirePerm perm="user:list">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminFirmSettingsPage />
                        </Suspense>
                      </ShelledRoute>
                    </RequirePerm>
                  }
                />
                <Route
                  path="/admin/ai-prompts"
                  element={
                    <RequirePerm perm="user:list">
                      <ShelledRoute>
                        <Suspense fallback={<RouteSpinner />}>
                          <AdminAiPromptsPage />
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
