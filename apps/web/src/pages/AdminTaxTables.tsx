import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Phase 14.6 — admin tax-tables browser.
 *
 * Read-only view into `tax_year_tables` and `tax_year_overrides`.
 * Operators answering "what bracket did 2024 use?" land here.
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
}

interface DataResponse {
  tables: TaxTableRow[];
  overrides: OverrideRow[];
}

async function call<T>(input: RequestInfo): Promise<T> {
  const res = await fetch(input, { credentials: "include" });
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
  return (await res.json()) as T;
}

export function AdminTaxTablesPage(): JSX.Element {
  const idx = useQuery({
    queryKey: ["admin", "tax-tables", "index"],
    queryFn: () => call<IndexResponse>("/api/v1/admin/tax-tables/index"),
  });

  const [year, setYear] = useState<number | null>(null);
  const [kind, setKind] = useState<string | null>(null);

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

  const allKinds = useMemo(() => {
    const yearObj = idx.data?.years.find((y) => y.year === year);
    return yearObj?.kinds ?? [];
  }, [idx.data, year]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Database className="h-5 w-5 text-primary" /> Tax-year tables
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only view into the seeded IRS rate tables and any mid-year overrides (e.g. OBBBA
          bonus-depreciation reinstatement). Source URLs link to the published revenue procedure.
        </p>
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
                {allKinds.map((k) => (
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
            <Card key={row.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>
                    {row.taxYear} —{" "}
                    <code className="rounded bg-muted px-1 text-sm">{row.kind}</code>
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    eff. {row.effectiveFrom.slice(0, 10)}
                    {row.effectiveTo ? ` → ${row.effectiveTo.slice(0, 10)}` : ""}
                  </span>
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
          ))}

          {dataQ.data.overrides.length > 0 && (
            <Card className="border-amber-500/40">
              <CardHeader>
                <CardTitle className="text-base">Overrides</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Mid-year corrections that supersede the seeded value for property / events
                  occurring on or after `effective_from`.
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
    </main>
  );
}
