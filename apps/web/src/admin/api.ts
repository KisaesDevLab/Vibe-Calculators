import { ApiError } from "@/auth/api";

/** Phase 24 + Phase 21 — admin API surface for API keys, webhooks, audit log. */

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    let issues: { path: string; message: string }[] | undefined;
    try {
      const j = JSON.parse(text) as {
        detail?: string;
        issues?: { path: string | string[]; message: string }[];
      };
      detail = j.detail ?? text;
      if (Array.isArray(j.issues)) {
        issues = j.issues.map((i) => ({
          path: Array.isArray(i.path) ? i.path.join(".") : i.path,
          message: i.message,
        }));
      }
    } catch {
      detail = text || res.statusText;
    }
    throw new ApiError(res.status, detail, issues);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  actAsUserId: string | null;
  issuedBy: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  actions: string[];
  archivedAt: string | null;
  createdAt: string;
  lastFiredAt: string | null;
  lastFailureMessage: string | null;
}

export interface AuditEventRow {
  id: string;
  action: string;
  actorId: string | null;
  entityKind: string | null;
  entityId: string | null;
  payload: unknown;
  createdAt: string;
  prevHash: string | null;
  rowHash: string;
}

export const adminApi = {
  // API keys
  async listApiKeys(): Promise<ApiKeyRow[]> {
    const j = await call<{ apiKeys: ApiKeyRow[] }>("/api/v1/admin/api-keys");
    return j.apiKeys;
  },
  async createApiKey(input: {
    name: string;
    scopes?: string[];
    expiresInDays?: number;
  }): Promise<{ apiKey: ApiKeyRow; plaintext: string }> {
    return call<{ apiKey: ApiKeyRow; plaintext: string }>("/api/v1/admin/api-keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async revokeApiKey(id: string): Promise<void> {
    await call<void>(`/api/v1/admin/api-keys/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    });
  },

  // Webhooks
  async listWebhooks(): Promise<WebhookRow[]> {
    const j = await call<{ webhooks: WebhookRow[] }>("/api/v1/webhooks");
    return j.webhooks;
  },
  async createWebhook(input: {
    name: string;
    url: string;
    actions: string[];
  }): Promise<{ webhook: WebhookRow; secret: string }> {
    return call<{ webhook: WebhookRow; secret: string }>("/api/v1/webhooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async deleteWebhook(id: string): Promise<void> {
    await call<void>(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  // Audit
  async listAuditEvents(opts: { action?: string; limit?: number } = {}): Promise<AuditEventRow[]> {
    const params = new URLSearchParams();
    if (opts.action) params.set("action", opts.action);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const j = await call<{ events: AuditEventRow[] }>(`/api/v1/audit/events${qs ? "?" + qs : ""}`);
    return j.events;
  },
  async validateAuditChain(): Promise<{
    valid: boolean;
    checked: number;
    firstBadId: string | null;
  }> {
    return call("/api/v1/audit/chain/validate");
  },
};
