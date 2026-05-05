import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { calculatorsApi, type CalculatorCatalogEntry } from "@/calculators/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Phase 15.4 — calculator picker.
 *
 * Fetches the registry catalog from the API and renders a grouped list.
 * The TVM workbench is a special entry hand-added at the top because it
 * is not registry-driven (it's the freeform cash-flow event editor).
 */

export function CalculatorsPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["calculators", "catalog"],
    queryFn: () => calculatorsApi.catalog(),
    staleTime: 5 * 60_000,
  });

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">Loading…</main>
    );
  }
  if (query.isError) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Calculators</h1>
        <p className="mt-2 text-sm text-destructive">
          Failed to load calculators: {String((query.error as Error).message)}
        </p>
      </main>
    );
  }

  const calculators = query.data ?? [];
  const grouped = new Map<string, CalculatorCatalogEntry[]>();
  for (const c of calculators) {
    const cat = c.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(c);
  }
  const categories = [...grouped.keys()].sort();

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Calculators</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {calculators.length} calculators registered. Pick one to open its form.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          TVM workbench
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Link to="/calculators/tvm-workbench" className="block">
            <Card className="h-full transition hover:border-primary/60">
              <CardHeader>
                <CardTitle className="text-base">Cash-flow workbench</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Build a custom amortization schedule with arbitrary cash-flow events: loans,
                payments, rate changes, balloons, skips. The freeform editor.
              </CardContent>
            </Card>
          </Link>
        </div>
      </section>

      {categories.map((cat) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {cat}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {grouped
              .get(cat)!
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <Link
                  key={c.kind}
                  to={`/calculators/${encodeURIComponent(c.kind)}`}
                  className="block"
                >
                  <Card className="h-full transition hover:border-primary/60">
                    <CardHeader>
                      <CardTitle className="text-base">{c.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                      <p>{c.description}</p>
                      {c.formReferences.length > 0 && (
                        <p className="text-xs">
                          <span className="font-medium text-foreground">Refs:</span>{" "}
                          {c.formReferences.join(" · ")}
                        </p>
                      )}
                      {c.taxYears.length > 0 && (
                        <p className="text-xs">
                          <span className="font-medium text-foreground">Tax years:</span>{" "}
                          {c.taxYears.join(", ")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </main>
  );
}
