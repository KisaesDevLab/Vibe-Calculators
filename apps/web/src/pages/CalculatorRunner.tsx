import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { calculatorsApi, type CalculatorComputeResponse } from "@/calculators/api";
import { ApiError } from "@/auth/api";
import { AutoForm } from "@/calculators/AutoForm";

/**
 * Phase 15.4 — generic auto-form-driven calculator runner.
 *
 * Loads the calculator's metadata + JSON-schema from the catalog
 * endpoint and renders a form. On submit, POSTs to the compute
 * endpoint and renders the output + narrative + form references.
 */

export function CalculatorRunnerPage(): JSX.Element {
  const { kind = "" } = useParams();
  const meta = useQuery({
    queryKey: ["calculator", kind],
    queryFn: () => calculatorsApi.get(kind),
    staleTime: 5 * 60_000,
    enabled: kind !== "",
  });

  const [result, setResult] = useState<CalculatorComputeResponse | null>(null);
  const [lastInputs, setLastInputs] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issues, setIssues] = useState<{ path: string; message: string }[] | null>(null);

  async function compute(values: Record<string, unknown>): Promise<void> {
    setSubmitting(true);
    setIssues(null);
    try {
      const r = await calculatorsApi.compute(kind, values);
      setResult(r);
      setLastInputs(values);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.issues) setIssues(err.issues);
        toast.error(err.message);
      } else {
        toast.error(String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (meta.isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">Loading…</main>
    );
  }
  if (meta.isError || !meta.data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link
          to="/calculators"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Calculator not found</h1>
        <p className="mt-2 text-sm text-destructive">
          {String((meta.error as Error)?.message ?? "Unknown error")}
        </p>
      </main>
    );
  }

  const calc = meta.data;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link
        to="/calculators"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All calculators
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{calc.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{calc.description}</p>
        {calc.formReferences.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">References:</span>{" "}
            {calc.formReferences.join(" · ")}
          </p>
        )}
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs</CardTitle>
          </CardHeader>
          <CardContent>
            <AutoForm
              schema={calc.inputSchema}
              onSubmit={compute}
              submitting={submitting}
              submitLabel="Compute"
            />
            {issues && issues.length > 0 && (
              <div className="mt-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p className="font-medium">Validation:</p>
                <ul className="mt-1 space-y-0.5">
                  {issues.map((i, idx) => (
                    <li key={idx}>
                      <span className="font-mono">{i.path || "(root)"}</span>: {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent>
            {!result && (
              <p className="text-sm text-muted-foreground">
                Fill in the form on the left and click Compute to see the result here.
              </p>
            )}
            {result && (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed">{result.narrative}</p>
                <ResultGrid output={result.output} />
                <details className="rounded-md border border-input">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                    Raw JSON
                  </summary>
                  <pre className="overflow-x-auto bg-muted/30 p-3 text-xs">
                    {JSON.stringify(result.output, null, 2)}
                  </pre>
                </details>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setResult(null)}>
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(result.output, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${calc.kind}-result.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!lastInputs) return;
                      try {
                        const res = await fetch(
                          `/api/v1/calculators/${encodeURIComponent(calc.kind)}/pdf`,
                          {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(lastInputs),
                          },
                        );
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${calc.kind}-${new Date().toISOString().slice(0, 10)}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <FileDown className="mr-1 h-3 w-3" />
                    PDF
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

/**
 * Phase 16+ — present a tax-calculator's output JSON as a labelled
 * grid rather than a raw `JSON.stringify` blob. Each top-level key
 * becomes a row; nested objects become a sub-table; arrays render
 * as bulleted lists if scalar, or as rows-of-rows if objects.
 *
 * This isn't per-calculator-bespoke (each calculator could ship its
 * own renderer for highest fidelity), but it's enough that a CPA
 * sees "Section 179 Deduction: $1,160,000" instead of unreadable
 * code formatting on day 1.
 */
function ResultGrid({ output }: { output: unknown }): JSX.Element {
  if (output === null || output === undefined) {
    return <p className="text-sm text-muted-foreground">No structured output.</p>;
  }
  if (typeof output !== "object") {
    return <p className="text-sm">{String(output)}</p>;
  }
  const entries = Object.entries(output as Record<string, unknown>);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">(empty)</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-input">
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b last:border-b-0">
              <td className="w-1/3 bg-muted/30 px-3 py-1.5 align-top text-xs font-medium text-muted-foreground">
                {humanizeKey(key)}
              </td>
              <td className="px-3 py-1.5 align-top">{renderValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function humanizeKey(key: string): string {
  // camelCase → Title Case ("totalDeduction" → "Total deduction")
  const spaced = key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function renderValue(value: unknown): JSX.Element {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground">—</span>;
  }
  if (typeof value === "boolean") {
    return <span>{value ? "Yes" : "No"}</span>;
  }
  if (typeof value === "number") {
    // Heuristic: format as currency if abs() >= 1 and looks money-shaped.
    return <span className="font-mono text-right">{formatNumber(value)}</span>;
  }
  if (typeof value === "string") {
    // Money-string heuristic: a numeric string that came from decimal.js.
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return <span className="font-mono">{formatNumber(Number(value))}</span>;
    }
    return <span>{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="italic text-muted-foreground">(none)</span>;
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return (
        <ul className="list-disc pl-5">
          {value.map((v, i) => (
            <li key={i}>{renderValue(v)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <ResultGrid key={i} output={v} />
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return <ResultGrid output={value} />;
  }
  return <span>{String(value)}</span>;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Currency for non-tiny values; plain otherwise (rates, counts).
  if (Math.abs(n) >= 1 && Number.isInteger(n * 100)) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
