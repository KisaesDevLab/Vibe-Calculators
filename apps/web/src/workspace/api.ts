/**
 * Phase 20 — workspace REST client.
 *
 * Thin typed wrappers over the apps/api routes added in Phase 20.
 * Schema mirrors the JSON shape rather than depending on the shared
 * @vibe-calc/db types (which would pull drizzle into the browser).
 */

export class WorkspaceApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
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
    let detail = res.statusText;
    let issues: { path: string; message: string }[] | undefined;
    try {
      const json = (await res.json()) as {
        detail?: string;
        issues?: { path: string | string[]; message: string }[];
      };
      if (json.detail) detail = json.detail;
      if (Array.isArray(json.issues)) {
        issues = json.issues.map((i) => ({
          path: Array.isArray(i.path) ? i.path.join(".") : i.path,
          message: i.message,
        }));
      }
    } catch {
      /* swallow */
    }
    throw new WorkspaceApiError(res.status, detail, issues);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type ClientEntityType =
  | "individual"
  | "sole_prop"
  | "single_member_llc"
  | "multi_member_llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "trust"
  | "estate"
  | "nonprofit"
  | "other";

export interface ClientSummary {
  id: string;
  name: string;
  entityType: ClientEntityType;
  ein: string | null;
  address: Record<string, string | undefined>;
  primaryContact: Record<string, string | undefined>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type EngagementStatus = "draft" | "in_review" | "approved" | "closed";
export type EngagementType =
  | "tax_planning"
  | "tax_prep"
  | "advisory"
  | "loan_modeling"
  | "audit_support"
  | "other";

export interface EngagementSummary {
  id: string;
  clientId: string;
  name: string;
  taxYear: number | null;
  engagementType: EngagementType;
  status: EngagementStatus;
  assignedPreparerId: string | null;
  assignedReviewerId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CalculationSummary {
  id: string;
  engagementId: string | null;
  clientId: string | null;
  kind: string;
  name: string;
  status: "draft" | "ready_for_review" | "approved";
  version: number;
  computedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  usageCount?: number;
}

export interface SearchHit {
  kind: "client" | "engagement" | "calculation";
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string;
  engagementId?: string | null;
  clientId?: string | null;
}

export interface QueueResponse {
  myEngagements: Array<{
    id: string;
    clientId: string;
    name: string;
    taxYear: number | null;
    status: EngagementStatus;
    engagementType: EngagementType;
    assignedPreparerId: string | null;
    assignedReviewerId: string | null;
    updatedAt: string;
    slaFlagged: boolean;
    daysSinceUpdate: number;
  }>;
  pendingReviewCalculations: Array<{
    id: string;
    engagementId: string | null;
    kind: string;
    name: string;
    status: string;
    updatedAt: string;
  }>;
  slaThresholdDays: number;
}

// ---------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------

export const workspaceApi = {
  // Clients
  listClients(
    params: {
      q?: string | undefined;
      entityType?: string | undefined;
      includeArchived?: boolean | undefined;
      sort?: "name" | "created" | "updated" | undefined;
    } = {},
  ): Promise<{
    clients: ClientSummary[];
  }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.entityType) qs.set("entityType", params.entityType);
    if (params.includeArchived !== undefined)
      qs.set("includeArchived", String(params.includeArchived));
    if (params.sort) qs.set("sort", params.sort);
    return call(`/api/v1/clients${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  createClient(input: {
    name: string;
    entityType: ClientEntityType;
    ein?: string;
    address?: Record<string, string>;
    primaryContact?: Record<string, string>;
  }): Promise<{ client: ClientSummary }> {
    return call(`/api/v1/clients`, { method: "POST", body: JSON.stringify(input) });
  },
  getClient(id: string): Promise<{
    client: ClientSummary;
    engagements: EngagementSummary[];
    recentCalculations: CalculationSummary[];
    tags: TagRow[];
  }> {
    return call(`/api/v1/clients/${encodeURIComponent(id)}`);
  },
  updateClient(
    id: string,
    input: Partial<{
      name: string;
      entityType: ClientEntityType;
      ein: string;
      address: Record<string, string>;
      primaryContact: Record<string, string>;
    }>,
  ): Promise<{ client: ClientSummary }> {
    return call(`/api/v1/clients/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  archiveClient(id: string): Promise<{ client: ClientSummary }> {
    return call(`/api/v1/clients/${encodeURIComponent(id)}/archive`, { method: "POST" });
  },
  restoreClient(id: string): Promise<{ client: ClientSummary }> {
    return call(`/api/v1/clients/${encodeURIComponent(id)}/restore`, { method: "POST" });
  },

  // Engagements
  listEngagements(
    params: {
      clientId?: string | undefined;
      taxYear?: number | undefined;
      status?: EngagementStatus | undefined;
    } = {},
  ): Promise<{
    engagements: EngagementSummary[];
  }> {
    const qs = new URLSearchParams();
    if (params.clientId) qs.set("clientId", params.clientId);
    if (params.taxYear !== undefined) qs.set("taxYear", String(params.taxYear));
    if (params.status) qs.set("status", params.status);
    return call(`/api/v1/engagements${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  createEngagement(input: {
    clientId: string;
    name: string;
    taxYear?: number | null;
    engagementType?: EngagementType;
  }): Promise<{ engagement: EngagementSummary }> {
    return call(`/api/v1/engagements`, { method: "POST", body: JSON.stringify(input) });
  },
  getEngagement(id: string): Promise<{
    engagement: EngagementSummary;
    calculations: CalculationSummary[];
    tags: TagRow[];
  }> {
    return call(`/api/v1/engagements/${encodeURIComponent(id)}`);
  },
  updateEngagement(
    id: string,
    input: Partial<{
      name: string;
      taxYear: number | null;
      engagementType: EngagementType;
    }>,
  ): Promise<{ engagement: EngagementSummary }> {
    return call(`/api/v1/engagements/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  assignEngagement(
    id: string,
    input: { preparerId?: string | null; reviewerId?: string | null },
  ): Promise<{
    engagement: EngagementSummary;
  }> {
    return call(`/api/v1/engagements/${encodeURIComponent(id)}/assign`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  transitionEngagement(
    id: string,
    to: EngagementStatus,
  ): Promise<{ engagement: EngagementSummary }> {
    return call(`/api/v1/engagements/${encodeURIComponent(id)}/transition`, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
  },
  archiveEngagement(id: string): Promise<{ engagement: EngagementSummary }> {
    return call(`/api/v1/engagements/${encodeURIComponent(id)}/archive`, { method: "POST" });
  },

  // Calculations
  listCalculations(
    params: {
      clientId?: string | undefined;
      engagementId?: string | undefined;
      kind?: string | undefined;
    } = {},
  ): Promise<{
    calculations: CalculationSummary[];
  }> {
    const qs = new URLSearchParams();
    if (params.clientId) qs.set("clientId", params.clientId);
    if (params.engagementId) qs.set("engagementId", params.engagementId);
    if (params.kind) qs.set("kind", params.kind);
    return call(`/api/v1/calculations${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  archiveCalculation(id: string): Promise<{ calculation: CalculationSummary }> {
    return call(`/api/v1/calculations/${encodeURIComponent(id)}/archive`, { method: "POST" });
  },
  bulkArchiveCalculations(ids: string[]): Promise<{ archivedIds: string[]; requested: number }> {
    return call(`/api/v1/calculations/bulk/archive`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  },

  // Tags
  listTags(q?: string): Promise<{ tags: TagRow[] }> {
    return call(`/api/v1/tags${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  },
  attachTag(input: {
    tagId?: string;
    tagName?: string;
    entityKind: "client" | "engagement" | "calculation";
    entityId: string;
  }): Promise<void> {
    return call(`/api/v1/tags/attach`, { method: "POST", body: JSON.stringify(input) });
  },
  detachTag(input: {
    tagId: string;
    entityKind: "client" | "engagement" | "calculation";
    entityId: string;
  }): Promise<void> {
    return call(`/api/v1/tags/detach`, { method: "POST", body: JSON.stringify(input) });
  },
  bulkAttachTag(input: {
    tagId?: string;
    tagName?: string;
    entityKind: "client" | "engagement" | "calculation";
    entityIds: string[];
  }): Promise<{ attached: number; tagId: string }> {
    return call(`/api/v1/tags/bulk-attach`, { method: "POST", body: JSON.stringify(input) });
  },

  // Search
  search(q: string): Promise<{ hits: SearchHit[] }> {
    return call(`/api/v1/search?q=${encodeURIComponent(q)}`);
  },

  // Queue
  myQueue(): Promise<QueueResponse> {
    return call(`/api/v1/queue`);
  },

  // Bulk actions
  bulkArchiveCalcs(ids: string[]): Promise<{ updatedIds: string[]; requested: number }> {
    return call(`/api/v1/bulk/calculations/archive`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  },
  bulkRestoreCalcs(ids: string[]): Promise<{ updatedIds: string[]; requested: number }> {
    return call(`/api/v1/bulk/calculations/restore`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  },
  bulkChangeTaxYear(
    ids: string[],
    taxYear: number | null,
  ): Promise<{ updatedEngagements: number; taxYear: number | null }> {
    return call(`/api/v1/bulk/calculations/change-tax-year`, {
      method: "POST",
      body: JSON.stringify({ ids, taxYear }),
    });
  },
  bulkReassign(
    engagementIds: string[],
    input: { preparerId?: string | null; reviewerId?: string | null },
  ): Promise<{ updatedIds: string[]; requested: number }> {
    return call(`/api/v1/bulk/engagements/reassign`, {
      method: "POST",
      body: JSON.stringify({ engagementIds, ...input }),
    });
  },
};
