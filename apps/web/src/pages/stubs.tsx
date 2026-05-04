/**
 * Phase 4 stub pages — every top-level area named in the build plan
 * has a destination route so cmd-K navigation works. Phase 11+
 * replaces these with the real pages.
 */

function Stub({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </main>
  );
}

export const CalculatorsStub = (): JSX.Element => (
  <Stub
    title="Calculators"
    body="The TVM workbench (Phase 11) and tax calculators (Phase 16+) live here. This stub exists so the cmd-K palette can navigate to it from day one."
  />
);

export const ClientsStub = (): JSX.Element => (
  <Stub title="Clients" body="The clients index (Phase 20) lives here." />
);

export const EngagementsStub = (): JSX.Element => (
  <Stub title="Engagements" body="The engagement workspace (Phase 20) lives here." />
);

export const ReportsStub = (): JSX.Element => (
  <Stub
    title="Reports"
    body="The reporting / export pipeline (Phase 13) lives here. Until then, exports are triggered from individual calculation pages."
  />
);
