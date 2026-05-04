import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { RequireAuth, RequirePerm } from "./guards";

function withProviders(ui: React.ReactNode, initial = "/protected"): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/login" element={<p>login page</p>} />
            <Route path="/protected" element={ui} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function PermissionsProbe(): JSX.Element {
  const { user, hasPermission } = useAuth();
  return (
    <div>
      <p data-testid="role">{user?.role ?? "none"}</p>
      <p data-testid="canRead">{hasPermission("calculation:read") ? "yes" : "no"}</p>
      <p data-testid="canApprove">{hasPermission("calculation:approve") ? "yes" : "no"}</p>
    </div>
  );
}

describe("AuthProvider + useAuth", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it("populates user + permissions from /api/v1/auth/me", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        user: {
          id: "u1",
          email: "alice@firm.test",
          name: "Alice",
          role: "preparer",
          status: "active",
          totpEnabled: false,
          permissions: ["calculation:read", "calculation:create"],
        },
        session: null,
      }),
    });

    render(withProviders(<PermissionsProbe />));

    await waitFor(() => {
      expect(screen.getByTestId("role")).toHaveTextContent("preparer");
    });
    expect(screen.getByTestId("canRead")).toHaveTextContent("yes");
    expect(screen.getByTestId("canApprove")).toHaveTextContent("no");
  });

  it("RequireAuth redirects to /login when /me returns 401", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "{}",
      json: async () => ({}),
    });

    render(
      withProviders(
        <RequireAuth>
          <p>protected content</p>
        </RequireAuth>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText(/login page/i)).toBeInTheDocument();
    });
  });

  it("RequirePerm shows 403 when the user lacks the permission", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        user: {
          id: "u1",
          email: "ro@firm.test",
          name: "Read Only",
          role: "readonly",
          status: "active",
          totpEnabled: false,
          permissions: ["calculation:read"],
        },
        session: null,
      }),
    });

    render(
      withProviders(
        <RequirePerm perm="calculation:approve">
          <p>secret</p>
        </RequirePerm>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
