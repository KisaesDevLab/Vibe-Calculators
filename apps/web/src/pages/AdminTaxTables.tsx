import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Pencil, Copy, Archive, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Phase 14.6 / 14.5 — admin tax-tables browser + maintenance.
 *
 * Operators can add new (year, kind) rows for next year's IRS Rev.
 * Proc., update existing payloads to fix typos, clone a row to a new
 * year as a starting point, supersede a row that's been replaced,
 * or hard-delete a mistake. Every change records an audit event.
 */

interface TaxTableRow {
  id: string;
  taxYear: number;
  kind: string;
  payload: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string | null;
  sourceVersion: string | null;
  supersededAt: string | null;
}

interface OverrideRow {
  id: string;
  taxYear: number;
  kind: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  payload: unknown;
  sourceUrl: string | null;
  sourceVersion: string | null;
  note: string | null;
  createdAt: string;
}

interface IndexResponse {
  years: { year: number; kinds: string[] }[];
  allKinds?: string[];
}

interface DataResponse {
  tables: TaxTableRow[];
  overrides: OverrideRow[];
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
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type EditorMode =
  | { kind: "create" }
  | { kind: "edit"; row: TaxTableRow }
  | { kind: "clone"; row: TaxTableRow };

export function AdminTaxTablesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const idx = useQuery({
    queryKey: ["admin", "tax-tables", "index"],
    queryFn: () => call<IndexResponse>("/api/v1/admin/tax-tables/index"),
  });

  const [year, setYear] = useState<number | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorMode | null>(null);

  const dataQ = useQuery({
    queryKey: ["admin", "tax-tables", "data", year, kind],
    queryFn: () => {
      const p = new URLSearchParams();
      if (year !== null) p.set("year", String(year));
      if (kind !== null) p.set("kind", kind);
      return call<DataResponse>(`/api/v1/admin/tax-tables?${p.toString()}`);
    },
    enabled: year !== null,
  });

  const allKindsForYear = useMemo(() => {
    const yearObj = idx.data?.years.find((y) => y.year === year);
    return yearObj?.kinds ?? [];
  }, [idx.data, year]);

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["admin", "tax-tables"] });
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Database className="h-5 w-5 text-primary" /> Tax-year tables
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse, add, edit, clone, or supersede the seeded IRS rate tables. Every change writes
            an audit row. Source URLs link to the published revenue procedure.
          </p>
        </div>
        <Button onClick={() => setEditor({ kind: "create" })}>
          <Plus className="mr-1 h-4 w-4" /> New row
        </Button>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Browse</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Year
              </span>
              <select
                value={year ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setYear(v ? Number(v) : null);
                  setKind(null);
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— select —</option>
                {idx.data?.years.map((y) => (
                  <option key={y.year} value={y.year}>
                    {y.year}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Kind (optional)
              </span>
              <select
                value={kind ?? ""}
                onChange={(e) => setKind(e.target.value || null)}
                disabled={year === null}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">All kinds</option>
                {allKindsForYear.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {dataQ.isError && (
        <p className="text-sm text-destructive">{(dataQ.error as Error).message}</p>
      )}

      {dataQ.data && (
        <div className="space-y-4">
          {dataQ.data.tables.length === 0 && (
            <p className="text-sm text-muted-foreground">No rows match.</p>
          )}
          {dataQ.data.tables.map((row) => (
            <TableCard
              key={row.id}
              row={row}
              onEdit={() => setEditor({ kind: "edit", row })}
              onClone={() => setEditor({ kind: "clone", row })}
              onSupersede={async () => {
                if (!window.confirm(`Mark this ${row.kind} row (${row.taxYear}) as superseded?`))
                  return;
                try {
                  await call(`/api/v1/admin/tax-tables/${row.id}/supersede`, { method: "POST" });
                  toast.success("Row superseded");
                  refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              }}
              onDelete={async () => {
                if (
                  !window.confirm(
                    `Delete the ${row.kind} row (${row.taxYear})? This is permanent. Use Supersede instead unless this row was created by mistake.`,
                  )
                )
                  return;
                try {
                  await call(`/api/v1/admin/tax-tables/${row.id}`, { method: "DELETE" });
                  toast.success("Row deleted");
                  refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          ))}

          {dataQ.data.overrides.length > 0 && (
            <Card className="border-amber-500/40">
              <CardHeader>
                <CardTitle className="text-base">Overrides</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Mid-year corrections that supersede the seeded value for property / events
                  occurring on or after `effective_from`. The resolver consults overrides first.
                </p>
                {dataQ.data.overrides.map((row) => (
                  <div key={row.id} className="mb-3 rounded-md border border-amber-500/40 p-3">
                    <p className="text-sm">
                      <strong>
                        {row.taxYear} {row.kind}
                      </strong>{" "}
                      from {row.effectiveFrom.slice(0, 10)}
                    </p>
                    {row.note && <p className="mt-1 text-xs">{row.note}</p>}
                    <pre className="mt-2 rounded bg-muted/30 p-2 text-xs">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                    {row.sourceUrl && (
                      <p className="mt-1 text-xs">
                        <a
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline"
                        >
                          {row.sourceVersion ?? row.sourceUrl}
                        </a>
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {editor && (
        <EditorDialog
          mode={editor}
          allKinds={idx.data?.allKinds ?? []}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}

function TableCard({
  row,
  onEdit,
  onClone,
  onSupersede,
  onDelete,
}: {
  row: TaxTableRow;
  onEdit: () => void;
  onClone: () => void;
  onSupersede: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            {row.taxYear} — <code className="rounded bg-muted px-1 text-sm">{row.kind}</code>
          </span>
          <div className="flex items-center gap-2 text-xs font-normal">
            <span className="text-muted-foreground">
              eff. {row.effectiveFrom.slice(0, 10)}
              {row.effectiveTo ? ` → ${row.effectiveTo.slice(0, 10)}` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={onEdit} title="Edit row">
              <Pencil className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onClone} title="Clone to new year">
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onSupersede()}
              title="Mark superseded"
              disabled={!!row.supersededAt}
            >
              <Archive className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onDelete()}
              title="Delete (admin escape hatch)"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">
          {row.sourceVersion}
          {row.sourceUrl && (
            <>
              {" · "}
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                source
              </a>
            </>
          )}
          {row.supersededAt && (
            <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
              superseded {row.supersededAt.slice(0, 10)}
            </span>
          )}
        </p>
        <pre className="overflow-x-auto rounded bg-muted/30 p-3 text-xs font-mono">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

interface EditorBody {
  target: "table" | "override";
  taxYear: number;
  kind: string;
  effectiveFrom: string;
  effectiveTo: string;
  payload: string;
  sourceUrl: string;
  sourceVersion: string;
  note: string;
}

function EditorDialog({
  mode,
  allKinds,
  onClose,
  onSaved,
}: {
  mode: EditorMode;
  allKinds: string[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const isClone = mode.kind === "clone";
  const seedRow = mode.kind !== "create" ? mode.row : null;

  const [form, setForm] = useState<EditorBody>(() => ({
    target: "table",
    taxYear: seedRow
      ? isClone
        ? seedRow.taxYear + 1
        : seedRow.taxYear
      : new Date().getUTCFullYear() + 1,
    kind: seedRow?.kind ?? allKinds[0] ?? "federal_tax_brackets",
    effectiveFrom: seedRow
      ? isClone
        ? `${seedRow.taxYear + 1}-01-01`
        : seedRow.effectiveFrom.slice(0, 10)
      : `${new Date().getUTCFullYear() + 1}-01-01`,
    effectiveTo: seedRow?.effectiveTo?.slice(0, 10) ?? "",
    payload: JSON.stringify(seedRow?.payload ?? {}, null, 2),
    sourceUrl: seedRow?.sourceUrl ?? "",
    sourceVersion: seedRow?.sourceVersion ?? "",
    note: "",
  }));
  const [submitting, setSubmitting] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(form.payload);
      } catch (err) {
        throw new Error(
          `Payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (typeof parsedPayload !== "object" || parsedPayload === null) {
        throw new Error("Payload must be a JSON object");
      }
      const body: Record<string, unknown> = {
        payload: parsedPayload,
        sourceUrl: form.sourceUrl || null,
        sourceVersion: form.sourceVersion || null,
      };
      if (form.effectiveFrom) body.effectiveFrom = form.effectiveFrom;
      if (form.effectiveTo) body.effectiveTo = form.effectiveTo;
      if (mode.kind === "edit") {
        await call(`/api/v1/admin/tax-tables/${mode.row.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        return;
      }
      if (mode.kind === "clone") {
        const cloneBody = {
          taxYear: form.taxYear,
          effectiveFrom: form.effectiveFrom,
          payload: parsedPayload,
          sourceUrl: form.sourceUrl || null,
          sourceVersion: form.sourceVersion || null,
        };
        await call(`/api/v1/admin/tax-tables/${mode.row.id}/clone`, {
          method: "POST",
          body: JSON.stringify(cloneBody),
        });
        return;
      }
      // create
      const createBody = {
        target: form.target,
        taxYear: form.taxYear,
        kind: form.kind,
        effectiveFrom: form.effectiveFrom,
        ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
        payload: parsedPayload,
        sourceUrl: form.sourceUrl || null,
        sourceVersion: form.sourceVersion || null,
        ...(form.note ? { note: form.note } : {}),
      };
      await call(`/api/v1/admin/tax-tables`, {
        method: "POST",
        body: JSON.stringify(createBody),
      });
    },
    onSuccess: () => {
      toast.success(
        mode.kind === "edit" ? "Row updated" : mode.kind === "clone" ? "Row cloned" : "Row created",
      );
      onSaved();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
    onSettled: () => setSubmitting(false),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {mode.kind === "edit"
            ? `Edit row: ${mode.row.taxYear} ${mode.row.kind}`
            : mode.kind === "clone"
              ? `Clone ${mode.row.taxYear} ${mode.row.kind} → new row`
              : "New tax-table row"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode.kind === "edit"
            ? "Edits affect every recompute that consumes this row. The audit log records the change."
            : mode.kind === "clone"
              ? "Pick the new fiscal year + effective date. Payload + source default to the source row; tweak as needed."
              : "Use a tax_year_overrides target for mid-year corrections that supersede a seeded value."}
        </p>

        <div className="mt-4 space-y-4">
          {mode.kind === "create" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Target table">
                  <select
                    value={form.target}
                    onChange={(e) =>
                      setForm({ ...form, target: e.target.value as "table" | "override" })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="table">tax_year_tables (seed)</option>
                    <option value="override">tax_year_overrides (mid-year correction)</option>
                  </select>
                </Field>
                <Field label="Kind">
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {allKinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          )}

          {mode.kind !== "edit" && (
            <Field label="Tax year">
              <Input
                type="number"
                value={form.taxYear}
                onChange={(e) => setForm({ ...form, taxYear: Number(e.target.value) })}
                min={1900}
                max={2100}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective from (YYYY-MM-DD)">
              <Input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </Field>
            <Field label="Effective to (optional)">
              <Input
                type="date"
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Source URL (IRS Pub / Rev. Proc. PDF)">
            <Input
              type="url"
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              placeholder="https://www.irs.gov/pub/irs-drop/rp-..."
            />
          </Field>

          <Field label="Source version (e.g. Rev. Proc. 2025-32)">
            <Input
              value={form.sourceVersion}
              onChange={(e) => setForm({ ...form, sourceVersion: e.target.value })}
              placeholder="Rev. Proc. 2025-32"
            />
          </Field>

          {mode.kind === "create" && form.target === "override" && (
            <Field label="Note (rationale for the override)">
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="OBBBA — 100% bonus reinstated for property in service on/after 2025-01-20"
              />
            </Field>
          )}

          <Field label="Payload (JSON)">
            <textarea
              value={form.payload}
              onChange={(e) => setForm({ ...form, payload: e.target.value })}
              rows={12}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Shape varies by kind. For federal_tax_brackets:{" "}
              <code>{`{ single: [{rate, upto}], mfj: [...], ... }`}</code>. For standard_deduction:{" "}
              <code>{`{ single, mfj, mfs, hoh, qw }`}</code>. Match the existing rows for guidance.
            </p>
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={submitting || save.isPending}
            onClick={() => {
              setSubmitting(true);
              save.mutate();
            }}
          >
            {save.isPending
              ? "Saving…"
              : mode.kind === "edit"
                ? "Save changes"
                : mode.kind === "clone"
                  ? "Create clone"
                  : "Create row"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
