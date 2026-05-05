import { ApiError } from "@/auth/api";

/**
 * Phase 15 — calculator catalog + compute API client.
 *
 * The web app does NOT import `@vibe-calc/tax-engine`. The registry
 * lives on the API side; the web app fetches the catalog and renders
 * the picker / auto-form entirely from the JSON-schema response.
 */

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  format?: string;
  items?: JsonSchema;
  minItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  // zod-to-json-schema attaches the Zod default value here.
  [k: string]: unknown;
}

export interface CalculatorCatalogEntry {
  kind: string;
  name: string;
  description: string;
  category: string;
  taxYears: number[];
  formReferences: string[];
  requiredTables: string[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface CalculatorComputeResponse {
  kind: string;
  output: Record<string, unknown>;
  narrative: string;
  formReferences: string[];
}

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
      const json = JSON.parse(text) as {
        detail?: string;
        issues?: { path: string | string[]; message: string }[];
      };
      detail = json.detail ?? text;
      if (Array.isArray(json.issues)) {
        issues = json.issues.map((i) => ({
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

export const calculatorsApi = {
  async catalog(): Promise<CalculatorCatalogEntry[]> {
    const j = await call<{ calculators: CalculatorCatalogEntry[] }>("/api/v1/calculators");
    return j.calculators;
  },

  async get(kind: string): Promise<CalculatorCatalogEntry> {
    return call<CalculatorCatalogEntry>(`/api/v1/calculators/${encodeURIComponent(kind)}`);
  },

  async compute(kind: string, input: unknown): Promise<CalculatorComputeResponse> {
    return call<CalculatorComputeResponse>(
      `/api/v1/calculators/${encodeURIComponent(kind)}/compute`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
};

/** Resolve a $ref like "#/definitions/foo" against the schema's own definitions block. */
export function resolveRef(schema: JsonSchema, ref: string): JsonSchema | null {
  if (!ref.startsWith("#/")) return null;
  const path = ref.slice(2).split("/");
  let cur: unknown = schema;
  for (const seg of path) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return null;
    }
  }
  return cur as JsonSchema;
}

/** Walk a schema's $ref if present, return the resolved schema. */
export function deref(root: JsonSchema, schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const resolved = resolveRef(root, schema.$ref);
  return resolved ?? schema;
}
