import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, authApi } from "@/auth/api";
import { useAuth } from "@/auth/AuthContext";

/**
 * Phase 2.11 — self-service profile.
 *
 * Bare-bones UI; Phase 4 supplies the polished version. Capabilities:
 * change password, set up 2FA, view/revoke active sessions.
 */

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function ProfilePage(): JSX.Element {
  const { user, refetch } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ----- Password ---------------------------------------------------
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const setPassword = useMutation({
    mutationFn: () =>
      authApi.setPassword({
        ...(user?.status === "pending" ? {} : { currentPassword }),
        newPassword,
      }),
    onSuccess: () => {
      setPwOk(true);
      setCurrentPassword("");
      setNewPassword("");
      setPwError(null);
      refetch();
    },
    onError: (err: unknown) => {
      setPwError(err instanceof ApiError ? err.message : "Could not save");
      setPwOk(false);
    },
  });
  function submitPw(e: FormEvent): void {
    e.preventDefault();
    setPassword.mutate();
  }

  // ----- 2FA --------------------------------------------------------
  const [enrollment, setEnrollment] = useState<{ otpauthUrl: string; qrPng: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [totpError, setTotpError] = useState<string | null>(null);

  const setupTotp = useMutation({
    mutationFn: () =>
      call<{ otpauthUrl: string; qrPng: string }>("/api/v1/me/2fa/setup", { method: "POST" }),
    onSuccess: (data) => {
      setEnrollment(data);
      setTotpError(null);
    },
    onError: (err: unknown) => {
      setTotpError(err instanceof ApiError ? err.message : "2FA setup failed");
    },
  });
  const enableTotp = useMutation({
    mutationFn: () =>
      call<{ recoveryCodes: string[] }>("/api/v1/me/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code: totpCode }),
      }),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setEnrollment(null);
      setTotpCode("");
      refetch();
    },
    onError: (err: unknown) => {
      setTotpError(err instanceof ApiError ? err.message : "Enable failed");
    },
  });

  // ----- Sessions ---------------------------------------------------
  const sessionsQuery = useQuery({
    queryKey: ["me", "sessions"],
    queryFn: () => call<{ sessions: SessionRow[] }>("/api/v1/me/sessions"),
    staleTime: 10_000,
  });
  const revokeSession = useMutation({
    mutationFn: (id: string) => call<void>(`/api/v1/me/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }),
  });

  async function logout(): Promise<void> {
    await authApi.logout();
    await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    navigate("/login", { replace: true });
  }

  if (!user) return <></>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <button onClick={() => void logout()} className="text-sm underline">
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {user.email} · {user.role}
      </p>

      {/* Password */}
      <section className="mt-8 rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Password</h2>
        <form onSubmit={submitPw} className="mt-3 grid max-w-md gap-3">
          {user.status !== "pending" && (
            <label className="block text-sm">
              Current password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          )}
          <label className="block text-sm">
            New password (12+ characters)
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          {pwError && <p className="text-sm text-destructive">{pwError}</p>}
          {pwOk && <p className="text-sm text-emerald-700">Password updated.</p>}
          <button
            type="submit"
            disabled={setPassword.isPending}
            className="self-start rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {setPassword.isPending ? "Saving…" : "Save password"}
          </button>
        </form>
      </section>

      {/* 2FA */}
      <section className="mt-6 rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Two-factor authentication</h2>
        {user.totpEnabled ? (
          <p className="mt-2 text-sm">
            <span className="text-emerald-700">Enabled.</span> Contact an admin if you need to
            reset.
          </p>
        ) : enrollment ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
            <img
              src={enrollment.qrPng}
              alt="TOTP QR code"
              className="h-40 w-40 rounded-md border border-border"
            />
            <div>
              <p className="text-sm">
                Scan with Google Authenticator, 1Password, or any TOTP app, then enter the 6-digit
                code below.
              </p>
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="123456"
                className="mt-2 block w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {totpError && <p className="mt-2 text-sm text-destructive">{totpError}</p>}
              <button
                onClick={() => enableTotp.mutate()}
                disabled={totpCode.length !== 6 || enableTotp.isPending}
                className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {enableTotp.isPending ? "Verifying…" : "Verify and enable"}
              </button>
            </div>
          </div>
        ) : recoveryCodes ? (
          <div className="mt-3">
            <p className="text-sm">
              2FA is enabled. Save these recovery codes — each works once if you lose your
              authenticator.
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : (
          <button
            onClick={() => setupTotp.mutate()}
            disabled={setupTotp.isPending}
            className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {setupTotp.isPending ? "Generating…" : "Set up 2FA"}
          </button>
        )}
      </section>

      {/* Email digest preference (Phase 22.7) */}
      <PreferencesSection />

      {/* Sessions */}
      <section className="mt-6 rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Active sessions</h2>
        {sessionsQuery.isLoading && <p className="mt-2 text-sm">Loading…</p>}
        {sessionsQuery.data && (
          <ul className="mt-3 space-y-2 text-sm">
            {sessionsQuery.data.sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <span>
                  {s.userAgent ?? "Unknown device"} · {s.ip ?? "?"} · last seen{" "}
                  {new Date(s.lastSeenAt).toLocaleString()}
                  {s.current && (
                    <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">
                      this session
                    </span>
                  )}
                </span>
                {!s.current && (
                  <button onClick={() => revokeSession.mutate(s.id)} className="text-xs underline">
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function PreferencesSection(): JSX.Element {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: () => call<{ emailDigest: "immediate" | "daily" | "off" }>("/api/v1/me/preferences"),
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const update = useMutation({
    mutationFn: (emailDigest: "immediate" | "daily" | "off") =>
      call<{ ok: true }>("/api/v1/me/preferences", {
        method: "PUT",
        body: JSON.stringify({ emailDigest }),
      }),
    onSuccess: () => {
      setOk(true);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["me", "preferences"] });
      setTimeout(() => setOk(false), 1500);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <section className="mt-6 rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Email preferences</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Notification cadence for in-app activity emails. Account-recovery and magic-link emails
        always send regardless of this setting.
      </p>
      {prefs.isLoading && <p className="mt-2 text-sm text-muted-foreground">Loading…</p>}
      {prefs.data && (
        <fieldset className="mt-3 space-y-2 text-sm">
          {(["immediate", "daily", "off"] as const).map((option) => (
            <label key={option} className="flex items-start gap-2">
              <input
                type="radio"
                name="emailDigest"
                checked={prefs.data.emailDigest === option}
                onChange={() => update.mutate(option)}
                disabled={update.isPending}
                className="mt-1"
              />
              <span>
                <span className="font-medium capitalize">{option}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {option === "immediate" && "every event sent right away"}
                  {option === "daily" && "one summary email at 7am firm-time"}
                  {option === "off" && "in-app only — no notification emails"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {ok && <p className="mt-2 text-xs text-emerald-600">Saved.</p>}
    </section>
  );
}
