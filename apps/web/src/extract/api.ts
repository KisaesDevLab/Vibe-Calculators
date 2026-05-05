import { ApiError } from "@/auth/api";

/** Phase 23 — extraction API client. */

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      const j = JSON.parse(text) as { detail?: string };
      detail = j.detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface ExtractionRow {
  id: string;
  sourceFilename: string;
  status: "pending" | "processing" | "needs_review" | "approved" | "failed";
  extractedJson: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExtractionRunResponse {
  extraction: ExtractionRow;
  flaggedFields: string[];
}

export interface UploadResponse {
  filename: string;
  mimeType: string;
  characters: number;
  pages?: number;
  text: string;
  redactionsApplied?: number;
}

export const extractApi = {
  async upload(file: File, redact: boolean): Promise<UploadResponse> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("redact", redact ? "true" : "false");
    const res = await fetch("/api/v1/extractions/upload", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      let detail: string;
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
      } catch {
        detail = text || res.statusText;
      }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as UploadResponse;
  },

  async create(input: {
    sourceFilename: string;
    documentText: string;
    clientId?: string;
    engagementId?: string;
  }): Promise<{ extraction: ExtractionRow }> {
    return call("/api/v1/extractions", { method: "POST", body: JSON.stringify(input) });
  },
  async list(): Promise<{ extractions: ExtractionRow[] }> {
    return call("/api/v1/extractions");
  },
  async run(id: string): Promise<ExtractionRunResponse> {
    return call(`/api/v1/extractions/${encodeURIComponent(id)}/run`, { method: "POST" });
  },
  async approve(id: string): Promise<{ extraction: ExtractionRow }> {
    return call(`/api/v1/extractions/${encodeURIComponent(id)}/approve`, { method: "POST" });
  },
  async get(id: string): Promise<ExtractionRunResponse> {
    return call(`/api/v1/extractions/${encodeURIComponent(id)}`);
  },
};
