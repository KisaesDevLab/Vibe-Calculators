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
                <div className="rounded-md bg-muted p-3">
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Output</p>
                  <pre className="whitespace-pre-wrap text-xs">
                    {JSON.stringify(result.output, null, 2)}
                  </pre>
                </div>
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
