import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/auth/AuthContext";
import { RequireAuth } from "@/auth/guards";
import { HealthPage } from "@/pages/Health";
import { LoginPage } from "@/pages/Login";
import { MagicLinkPage } from "@/pages/MagicLink";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/health" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login/magic" element={<MagicLinkPage />} />
            <Route
              path="/health"
              element={
                <RequireAuth>
                  <HealthPage />
                </RequireAuth>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
