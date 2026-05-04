import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type AuthUser } from "@/auth/api";
import { ROLES, type Role } from "@vibe-calc/shared-types";

/**
 * Phase 2.10 — admin user management.
 *
 * Bare-bones UI; Phase 4 supplies the polished design-system version.
 * The capabilities: invite (email + role), suspend, reset password,
 * force 2FA, view last login.
 */

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "pending" | "active" | "suspended";
  totpEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  archivedAt: string | null;
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = res.statusText;
    try {
      const j = JSON.parse(text) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function AdminUsersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => call<{ users: AdminUserRow[] }>("/api/v1/admin/users"),
    staleTime: 30_000,
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("preparer");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () =>
      call<{ user: AuthUser }>("/api/v1/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, name: inviteName, role: inviteRole }),
      }),
    onSuccess: async () => {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("preparer");
      setInviteError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: unknown) => {
      setInviteError(err instanceof ApiError ? err.message : "Could not invite");
    },
  });

  const suspend = useMutation({
    mutationFn: (id: string) => call<void>(`/api/v1/admin/users/${id}/suspend`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  const unsuspend = useMutation({
    mutationFn: (id: string) =>
      call<void>(`/api/v1/admin/users/${id}/unsuspend`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  const resetPassword = useMutation({
    mutationFn: (id: string) =>
      call<void>(`/api/v1/admin/users/${id}/reset-password`, { method: "POST" }),
  });
  const requireTotp = useMutation({
    mutationFn: (id: string) =>
      call<void>(`/api/v1/admin/users/${id}/require-2fa`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  function submitInvite(e: FormEvent): void {
    e.preventDefault();
    invite.mutate();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Invite firm staff, suspend access, force 2FA re-enrollment, or send a password-reset magic
        link.
      </p>

      <section className="mt-8 rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Invite a new user</h2>
        <form onSubmit={submitInvite} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <input
            type="email"
            placeholder="Email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Full name"
            required
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={invite.isPending}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {invite.isPending ? "Inviting…" : "Invite"}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-sm text-destructive">{inviteError}</p>}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Existing users</h2>
        {usersQuery.isLoading && <p className="mt-2 text-sm text-muted-foreground">Loading…</p>}
        {usersQuery.error instanceof ApiError && usersQuery.error.status === 403 && (
          <p className="mt-2 text-sm text-destructive">Forbidden — admin role required.</p>
        )}
        {usersQuery.data && (
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">2FA</th>
                  <th className="px-3 py-2">Last login</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.users.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2">{u.role}</td>
                    <td className="px-3 py-2">{u.status}</td>
                    <td className="px-3 py-2">{u.totpEnabled ? "on" : "off"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}
                    </td>
                    <td className="space-x-2 px-3 py-2">
                      {u.status !== "suspended" ? (
                        <button onClick={() => suspend.mutate(u.id)} className="text-xs underline">
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => unsuspend.mutate(u.id)}
                          className="text-xs underline"
                        >
                          Unsuspend
                        </button>
                      )}
                      <button
                        onClick={() => resetPassword.mutate(u.id)}
                        className="text-xs underline"
                      >
                        Reset password
                      </button>
                      {u.totpEnabled && (
                        <button
                          onClick={() => requireTotp.mutate(u.id)}
                          className="text-xs underline"
                        >
                          Reset 2FA
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
