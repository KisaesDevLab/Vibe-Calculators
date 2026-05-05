# Build-Plan Coverage Audit

**Date:** 2026-05-04
**Scope:** Compare what the 25-phase build plan promised against what's actually shipping in the running appliance. Triggered by the operator question _"where are the rest of the calculators?"_ after first-run setup.

## Headline

**Engines are 95% built and tested. The UI exposes ~10% of them.** Everything works in unit tests; almost nothing has a screen.

The phase log marks all 25 phases ✅ COMPLETE, but the per-item checklists were satisfied at the _engine_ and _infrastructure_ level — not at the user-visible-feature level. A reasonable summary: "we built the back of the house and a small fraction of the front."

| Layer                                                                                       | Built                                                                                                                | Missing                                                    |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Calc engine (TVM, Reg Z, templates)                                                         | ✅ Comprehensive (107 tests / 9 files)                                                                               | —                                                          |
| Tax engine (22 calculators)                                                                 | ✅ Comprehensive (104 tests / 22 calculator files)                                                                   | —                                                          |
| Domain API (clients, engagements, calculations CRUD, audit, scheduling, webhooks, api-keys) | ✅ Comprehensive (125 tests / 17 files)                                                                              | —                                                          |
| **Tax-engine HTTP surface**                                                                 | ❌ **Not built.** No `/api/v1/calculations/{kind}/compute` endpoint. The 22 calculators are never invoked over HTTP. | The whole route.                                           |
| **Tax calculator UI**                                                                       | ❌ **Not built.** Zero pages for any tax calculator.                                                                 | All 22 calculators.                                        |
| **TVM template UI**                                                                         | ❌ Not built. Bond, ASC 842 lease, NPV/IRR, sinking fund have engine code, no pages.                                 | 7 templates.                                               |
| TVM workbench (raw events)                                                                  | 🟡 Partial — base grid + recompute + chart + export-clipboard work                                                   | Missing ~12 of the ~22 listed Phase 11 actions (see below) |
| Workspace (clients/engagements/queue/admin)                                                 | ✅ Built                                                                                                             | —                                                          |
| Reports (Phase 13)                                                                          | ❌ Stub page                                                                                                         | Whole feature: PDF/XLSX/CSV/DOCX export pipeline UI        |
| Phase 23 AI extraction (`/extract`)                                                         | ❌ Not built (engine path never wired to UI)                                                                         | Whole feature                                              |
| Admin UI for AI / API keys / Webhooks                                                       | ❌ Not built (API works; no pages)                                                                                   | Three settings pages                                       |

---

## Detail by phase

### Phase 1–4 — platform — ✅ shipping

Auth, monorepo, Docker, design system, navigation shell — all functional. First-run setup wizard works (the post-fix flow of the last few sessions).

### Phase 5–10 — TVM math + regression suite — ✅ engine complete

`packages/calc-engine` modules:

- `cashflow-events.ts`, `cashflow-extensions.ts` (every series pattern from §7.11), `cashflow-schedule.ts`
- `compounding.ts`, `period-rate.ts`, `day-count.ts`, `date-arithmetic.ts`, `rounding.ts`
- `tvm-solver.ts`, `reg-z.ts`
- `templates.ts` (priceBond, bondYield, asc842LeasePv, npv, irr, mirr, sinkingFund)

107 tests across 9 files. Phase 10 regression-suite path was dropped (`phase-10-dropped` tag) — the TValue golden-file fixtures are not in the repo, so the parity bar is not CI-enforced. **Functional engine is correct against published-example fixtures, but the TValue-cents-level gate the plan called for does not exist.**

### Phase 11 — TVM workbench UI — 🟡 partial

`apps/web/src/pages/Workbench.tsx` (481 LOC) ships:

- Master controls bar (label / compounding / rate / day-count / compute method / payment timing) ✓ §11.15
- Editable event grid (subset: Event / Date / Amount / Rate / Count / Interval / Memo) — §11.1 partial; **missing End Date column (read-only auto-computed) and per-row Compounding override column.**
- Live recompute on every keystroke ✓ §11.5
- Bottom result panel with summary totals + tabular schedule ✓ §11.6
- Insert / Delete row, keyboard-only flow ✓ §11.17 partial

**Phase 11 actions NOT built:**

- §11.3 Series editor dialog (Insert Series action)
- §11.17 Expand Series (24 monthly → 24 individual rows)
- §11.17 Compress to Series (collapse N rows back into a series row)
- §11.17 Set Unknown / Restore Unknowns toggles ("U" markers)
- §11.17 Show Running Balance / Show Cumulative Totals toggles
- §11.17 Rounding Rule dialog
- §11.17 Sort action
- §11.16 Loan Details dialog (borrower/lender/preparer metadata)
- §11.18 Period-dropdown smart filtering (disabling incompatible intervals)
- §11.19 Multi-calculation tabs
- §11.20 Undo/redo stack with IndexedDB persistence
- §11.21 Date-arithmetic shortcuts (`+1m`, arrow inc/dec)
- §11.21 (partial) Date-only field shortcuts
- Compare-versions side-by-side viewer (§11.9)
- What-if duplicate (§11.10)
- Print preview (§11.11)
- Empty-state template picker (§11.13)

The **listed acceptance criterion** ("a power user builds a 30-year mortgage with one balloon and one rate change in under 60 seconds, keyboard only, schedule matches Phase 7 fixtures cents-level") is roughly achievable today, but only because the underlying engine is solid — the UI is missing most of the workflow polish the plan called for.

### Phase 12 — schedule rendering — 🟡 partial

ScheduleChart component exists, schedule grid renders with sticky header. Missing:

- §12.3 Negative-am rows visually highlighted
- §12.5 Per-row annotations UI (the `calculation_versions.row_annotations` column exists; no UI hits it)
- §12.6 Multiple chart kinds (only one ChartKind today; the plan called for principal-vs-interest stacked area, remaining-balance curve, cumulative-interest curve as switchable tabs)
- §12.7 **"Show me the math" tooltip** — the differentiator-vs-TValue feature; not built
- §12.9 Print stylesheet

### Phase 13 — reporting / export pipeline — ❌ stub only

`apps/web/src/pages/stubs.tsx` `<ReportsStub>` is the entire feature. Missing:

- Puppeteer PDF process pool
- All PDF templates (Amortization, Reg Z, Lease, Bond, IRR/NPV, tax memos)
- ExcelJS XLSX export with native formulas
- CSV / DOCX export
- BullMQ export job queue UI
- Bulk export → zip
- Email-this-PDF action
- Watermark / DRAFT mode

The `packages/pdf` workspace exists with `@react-pdf/renderer` + `exceljs` + `docx` deps installed (6 tests + 1 skipped — mostly stub tests), but the _pipeline_ and the _UI_ are not in place.

### Phase 14 — tax-year rate tables — ✅ schema; ⚠ seed sparse

`tax_year_tables` and `tax_year_overrides` tables exist. Whether the seed covers every kind listed in §14.2 across 2023–2026 was not verified in this audit.

### Phase 15 — tax engine framework — ✅ engine; ❌ all wiring

The `TaxCalculator<I,O>` interface exists. The registry exists at `packages/tax-engine/src/registry.ts`. All 22 calculators self-register. But:

- **§15.3 auto-generated REST endpoints — NOT BUILT.** No code in `apps/api/src/routes/` imports `@vibe-calc/tax-engine`. The registry is never read on the server. There is no `/api/v1/calculations/{kind}/compute` route.
- **§15.4 auto-generated frontend forms — NOT BUILT.** No code in `apps/web/src/` imports `@vibe-calc/tax-engine`. The registry is never read on the client. There is no calculator picker, no auto-form rendering, no result panel.
- §15.5 standard output panel, §15.6 help drawer, §15.7 fixture test runner — engine-side fixture runner exists; UI side does not.

This is the **single biggest gap** in the build. It's why the user sees no calculators despite the phase log marking phases 16–19 complete.

### Phase 16–19 — tax calculators — ✅ engines; ❌ no UI for any

22 calculator files in `packages/tax-engine/src/calculators/`, each with a `.test.ts`. **None has a UI page.** None is reachable over HTTP. They're tested in isolation and otherwise unreachable from the running appliance.

| Phase | File                        | Tests | API route | Web page |
| ----- | --------------------------- | ----: | :-------: | :------: |
| 16.1  | `macrs.ts`                  |     7 |    ❌     |    ❌    |
| 16.2  | `section-179.ts`            |     6 |    ❌     |    ❌    |
| 16.3  | `bonus-168k.ts`             |     5 |    ❌     |    ❌    |
| 16.4  | `depreciation-waterfall.ts` |     4 |    ❌     |    ❌    |
| 16.5  | `cost-segregation.ts`       |     3 |    ❌     |    ❌    |
| 17.1  | `rmd.ts`                    |     4 |    ❌     |    ❌    |
| 17.2  | `roth-conversion.ts`        |     3 |    ❌     |    ❌    |
| 17.3  | `capital-gains.ts`          |     5 |    ❌     |    ❌    |
| 17.4  | `qbi.ts`                    |     5 |    ❌     |    ❌    |
| 18.1  | `safe-harbor.ts`            |     4 |    ❌     |    ❌    |
| 18.2  | `se-tax.ts`                 |     4 |    ❌     |    ❌    |
| 18.3  | `state-tax.ts`              |     6 |    ❌     |    ❌    |
| 18.4  | `annualization.ts`          |     3 |    ❌     |    ❌    |
| 19.1  | `amt.ts`                    |     3 |    ❌     |    ❌    |
| 19.2  | `section-1031.ts`           |     3 |    ❌     |    ❌    |
| 19.3  | `installment-sale.ts`       |     3 |    ❌     |    ❌    |
| 19.4  | `section-121.ts`            |     4 |    ❌     |    ❌    |
| 19.5  | `irs-interest.ts`           |     5 |    ❌     |    ❌    |
| 19.6  | `hsa.ts`                    |     6 |    ❌     |    ❌    |
| 19.7  | `qualified-plan-limits.ts`  |     6 |    ❌     |    ❌    |
| 19.8  | `social-security.ts`        |     5 |    ❌     |    ❌    |

Phase 9 TVM templates have a similar shape — engine code, no UI:

| Phase | Template                                              |        API        |       Web       |
| ----- | ----------------------------------------------------- | :---------------: | :-------------: |
| 9.1   | Loan amortization                                     |  ✓ via Workbench  | ✓ via Workbench |
| 9.2   | Loan with balloon                                     |      partial      |     partial     |
| 9.3   | Bond price/yield (`templates.ts:priceBond/bondYield`) |        ❌         |       ❌        |
| 9.4   | ASC 842 / IFRS 16 lease (`asc842LeasePv`)             |        ❌         |       ❌        |
| 9.5   | TDR PV-of-future-cash-flows                           | ❌ engine missing |       ❌        |
| 9.6   | Imputed interest / §7872                              | ❌ engine missing |       ❌        |
| 9.7   | Below-market loan (§7872)                             | ❌ engine missing |       ❌        |
| 9.8   | Sinking fund (`sinkingFund`)                          |        ❌         |       ❌        |
| 9.9   | Lease rate factor / implicit rate                     | ❌ engine missing |       ❌        |
| 9.10  | Note buy/sell yield                                   | ❌ engine missing |       ❌        |
| 9.11  | IRR / MIRR / NPV (`npv/irr/mirr`)                     |        ❌         |       ❌        |

So Phase 9's "12 templates" are about half engine-built and zero UI-built.

### Phase 20 — workspace — ✅ shipping

Clients, ClientDetail, Engagements, EngagementDetail, MyQueue pages all exist. Tagging, search, bulk actions are wired in the API and the workspace UI. AdminUsers shipped.

### Phase 21 — versioning + audit — ✅ engine; 🟡 UI partial

Versioning route + audit hash chain are tested and working server-side. Comments thread, side-by-side version diff viewer, signed-PDF export are not in the UI.

### Phase 22 — scheduled recalc + AFR + email — ✅ engine; ⚠ UI thin

Schedules route + AFR auto-update job + 3-provider email are wired and tested. Whether the scheduling UI is exposed in the workspace was not deeply verified — likely thin.

### Phase 23 — AI loan extraction — ❌ engine; ❌ no UI

`packages/llm` exists with bare-fetch Anthropic provider + Zod schema. `apps/api/src/routes/extractions.ts` exists. **No `/extract` UI page.** The whole user-facing path is not in the app.

### Phase 24 — REST API + webhooks — ✅ API; ❌ admin UI

`api-keys.ts` and `webhooks.ts` routes work and are tested. **No admin UI** for either: no page to mint an API key, no page to subscribe a webhook. Operators would have to use `curl` with another admin's session cookie.

### Phase 25 — packaging + setup wizard + backup — ✅ wizard; 🟡 the rest

Setup wizard works (post-fix). Backup/restore recipes exist in justfile. The "vibecalc-installer CLI shim" in §25.5 / `doctor` checks in §25.6 / multi-day backup rotation in §25.7 / restore wizard UI in §25.8 — not verified, mostly likely partial.

---

## Why the phase log says ✅

Each phase's checklist item was satisfiable by writing the back-end code and tests. The plan implicitly assumed each phase's UI work would happen in the same sprint as its engine work — but the autopilot's sign-off rule was "items checked + tests green," and tests for _engine_ logic don't exercise UI. Result: the engine got rich, the UI stayed scaffold-thin, and nothing in CI flagged the divergence.

The plan's _acceptance_ criteria are stricter ("A staff CPA can build a 30-year mortgage…", "each calc has its own input form…", "the wizard correctly anchors each extracted field…"), but those are hard to test automatically without an E2E suite, and the build-plan E2E wasn't built (Phase 11 acceptance test is engine-only, not Playwright).

---

## Recommendations

The phase log should be **demoted from ✅ COMPLETE to 🟡 ENGINE COMPLETE** for phases 9, 11, 12, 13, 15, 16, 17, 18, 19, 21 (UI), 22 (UI), 23, 24 (admin UI). Then a re-plan:

### Tier 1 — minimum to be a usable product the operator just paid for

1. **Phase 15 wiring** (highest leverage, ~2–3 days):

   - `/api/v1/calculations/{kind}/compute` POST endpoint that introspects `listCalculators()` and dispatches.
   - `/api/v1/calculators` GET that returns the registry metadata (name, kind, taxYears, formReferences, JSON-schema-of-inputs).
   - Web `/calculators` index page that fetches the catalog and renders a calculator picker.
   - Auto-form generator that takes the calculator's input schema and produces a basic form (string, number, date, enum, money, rate fields). Output panel with the result + narrative.
   - This single piece unlocks **all 22 tax calculators** end-to-end.

2. **Phase 9 missing engines** (1–2 days): TDR, imputed interest, below-market loan, lease rate factor, note buy/sell, plus UI pages for the 7 already-built TVM templates.

3. **Phase 13 reporting MVP** (3–5 days): at minimum, a "PDF this calculation" button that produces an Amortization PDF or a Tax-Calc memo PDF. Stub the rest of the export pipeline.

### Tier 2 — finish the workbench

4. Phase 11 missing actions (Series editor, Expand/Compress, Set/Restore Unknowns, Loan Details dialog, sort, running balance + cumulative totals, period-dropdown filtering) — ~3 days.

5. Phase 12 "Show me the math" tooltip — the marquee differentiator. ~1 day.

### Tier 3 — admin completeness

6. AI settings page, API keys admin page, Webhooks admin page (each ~half day; backend already done).

7. Audit log viewer page.

### Deferred unless explicitly requested

- Phase 23 AI extraction UI — backend works; UI is greenfield.
- Phase 10 TValue golden-file regression suite — was dropped early; reinstate only if a customer asks for cents-level TValue parity certification.
- Multi-tab + undo/redo (§11.19/20) — nice-to-have polish.

---

## Bottom line

The build plan was ambitious (25 phases, many UI-heavy) and the autopilot delivered the math + data layer faithfully but punted most of the front-end. The good news: because every calculator implements the same `TaxCalculator<I,O>` interface and all 22 are already in a registry, **a single ~2-day sprint to wire Phase 15.3 + 15.4 properly will surface every missing tax calculator at once.** The work is mechanical, not architectural.

The TVM workbench is the existing UI proof-of-concept. Replicating its _pattern_ (form + live result + memo + export) for the registry-driven tax calculators is the path forward.
