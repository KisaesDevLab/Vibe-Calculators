import type { Permission, Role } from "@vibe-calc/shared-types";

/**
 * Phase 2.13 — typed wrappers around the auth REST surface.
 *
 * Every request goes through fetch() with credentials: 'include' so
 * the browser sends/receives the vibecalc_sid cookie.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "pending" | "active" | "suspended";
  totpEnabled: boolean;
  permissions: readonly Permission[];
}

export interface AuthMeResponse {
  user: AuthUser;
  session: { expiresAt: string; absoluteExpiresAt: string } | null;
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      const json = JSON.parse(text) as { detail?: string };
      detail = json.detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const authApi = {
  async me(): Promise<AuthMeResponse | null> {
    try {
      return await call<AuthMeResponse>("/api/v1/auth/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },

  async login(input: {
    email: string;
    password: string;
    totpCode?: string;
  }): Promise<AuthMeResponse> {
    return call<AuthMeResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async logout(): Promise<void> {
    await call<void>("/api/v1/auth/logout", { method: "POST" });
  },

  async requestMagicLink(email: string): Promise<void> {
    await call<{ accepted: true }>("/api/v1/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async consumeMagicLink(token: string): Promise<AuthMeResponse> {
    return call<AuthMeResponse>("/api/v1/auth/magic-link/consume", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  async setPassword(input: { currentPassword?: string; newPassword: string }): Promise<void> {
    await call<void>("/api/v1/me/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
