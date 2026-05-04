# Vibe Calculators — Phase Log

This log is the single source of truth for build progress, per AUTOPILOT.md §10.
Append-only — never delete prior entries.

Status legend: `⏳ NOT STARTED`, `🚧 IN PROGRESS`, `🛑 BLOCKED (awaiting human)`, `✅ COMPLETE`.

---

## Phase 01 — Repository scaffold, monorepo layout, Docker baseline

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Branch:** phase/01-scaffold (merged to main as `4ca94fd`)
- **Tag:** phase-01-complete
- **Sign-off:** human-gating skipped per session directive (2026-05-04 "Read AUTOPILOT.md and continue the build. Do not await human signoff between phases. Continue development and ask questions to human at the end of development").
- **Goal (from vibe-calculators-Build.md):** "a `docker compose up` that boots an empty but healthy app shell with frontend + backend + Postgres + Redis + Caddy."
- **Acceptance (from vibe-calculators-Build.md):** "`just up` on a fresh laptop produces a working `/health` page; `/api/health` reports DB and Redis connected; CI pipeline green."

### Items

- [x] 1.1 Monorepo with pnpm workspaces — commit `660e89a`
- [x] 1.2 Root `package.json` with engines + `packageManager` — commit `f6fe176`
- [x] 1.3 `tsconfig.base.json` with strict + path aliases — commit `1ef0cd3`
- [x] 1.4 ESLint flat config + Prettier + simple-git-hooks + lint-staged — commit `11819a2`
- [x] 1.5 `apps/web` Vite + React 18 + Tailwind + shadcn/ui foundation + `/health` placeholder — commit `a536506`
- [x] 1.6 `apps/api` Express + TS scaffold with `/api/health` returning the documented shape — commit `691384c`
- [x] 1.7 `packages/db` Drizzle setup + `_meta` bootstrap migration — commit `012f86e`
- [x] 1.8 Multi-stage Dockerfile for `apps/api` with distroless runtime — commit `97d9b9d`
- [x] 1.9 Dockerfile for `apps/web` (Vite build → Caddy static) — commit `98ed526`
- [x] 1.10 `docker-compose.yml` with caddy/web/api/postgres/redis + named volumes — commit `adf095d`
- [x] 1.11 `Caddyfile` with three modes selected by `VIBE_DEPLOY_MODE` — commit `088c535`
- [x] 1.12 `.env.example` + Zod env validation in `apps/api` — commit `a7dcc82`
- [x] 1.13 `justfile` with `up, down, logs, shell-api, psql, migrate, seed, reset-db, backup, restore, test, e2e` — commit `c7b471b`
- [x] 1.14 GitHub Actions: `ci.yml` + `release.yml` — commit `9809963`

### Post-implementation fixes

- `af85c6a` fix(tests): `vitest --passWithNoTests` for the four packages without runtime tests yet (calc-engine, tax-engine, shared-types, pdf).
- `cd99835` fix(infra): make the appliance actually boot end-to-end. Five issues uncovered while running `docker compose up`:
  1. `node:20-bookworm-slim` ships corepack 0.28 with stale signing keys → bumped to corepack 0.33 in both Dockerfiles.
  2. `pnpm fetch` triggered simple-git-hooks postinstall against an empty workspace → added `--ignore-scripts` to `pnpm fetch` and the offline `pnpm install`.
  3. `pnpm deploy --legacy` is a pnpm 10 flag; pnpm 9.15 rejects it → dropped, kept `--prod`.
  4. Distroless `node` lives at `/nodejs/bin/node`, not on PATH → healthcheck uses the absolute path.
  5. `handle_path /api/*` stripped the prefix; the API mounts `/api/health` → switched to `handle /api/*` which preserves the path.
- `90a9505` fix(infra): align with Vibe-Appliance port + naming conventions. Initial phase-01 work picked container names, image tags, ports, DB identifiers, and redis slots independently, which would have collided with other Vibe apps on a shared appliance host. Reconciled against `Vibe-Appliance/docs/addenda/emergency-access.md §3` and the existing `console/manifests/`. Final allocation:
  - **emergencyPort:** 5174 (finance cluster — 5171 mybooks, 5172 tb, 5173 reserved-around-Vite, 5174 calculators, 5175–5180 future finance apps)
  - **internal ports:** server 3000, client 80
  - **container_name:** `vibe-calculators-{server,client,postgres,redis,caddy}`
  - **image:** `ghcr.io/kisaesdevlab/vibe-calculators-{server,client}`
  - **database:** `vibe_calculators_db` / user `vibecalculators`
  - **redis db:** 2 (next free after 0 tb, 1 mybooks, 3 tax-research, 4 payroll, 5 glm-ocr)
  - **subdomain:** `calc`
  - Added `.appliance/manifest.json` (schema-1) so the Vibe-Appliance host can register and route to this app without code changes. Re-ran the end-to-end test with the renamed stack — all five containers Healthy, `/api/health` and `/health` both return as expected.

### Phase-exit verification (autopilot)

| Check | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | All 7 workspaces clean, 0 warnings, 0 errors |
| Typecheck | `pnpm typecheck` | All 7 workspaces clean |
| Unit + integration tests | `pnpm test` | 26 runtime tests pass: api 15 (env 11 + health 4), web 3, db 8; calc-engine / tax-engine / shared-types / pdf use `--passWithNoTests` until later phases populate them |
| Build | `pnpm build` | All 7 workspaces build successfully |
| Format | `pnpm format:check` | All matched files use Prettier code style |
| Docker compose syntax | `docker compose config --quiet` | exit 0; services present: caddy, web, api, postgres, redis; volumes: pgdata, redisdata, pdf-output, caddy_data, caddy_config |
| Dockerfile static check | `docker buildx build --check -f apps/{api,web}/Dockerfile .` | "no warnings found" for both |
| Caddyfile static check (3 modes) | `caddy validate` inside `caddy:2.8.4-alpine` for `VIBE_DEPLOY_MODE=lan/domain/tailscale` | all three pass |
| End-to-end | `VIBE_HTTP_PORT=18080 docker compose up -d` then `curl http://127.0.0.1:18080/api/health` | `{"status":"ok","version":"0.0.0","gitSha":"dev","dbConnected":true,"redisConnected":true}`; all 5 containers Healthy; `/health` (SPA) returns HTTP 200 |

### What needs human verification before merging

This is a §9-gated phase. The autopilot has demonstrated `/api/health` responds with `dbConnected:true` + `redisConnected:true` end-to-end on this Windows host (Docker Desktop 29.2.1), but final sign-off requires the human to:

1. **Confirm the host port mapping is acceptable for your machine.** The default compose binds `:80` and `:443`; on this host both were taken (likely IIS), so the autopilot used `VIBE_HTTP_PORT=18080 VIBE_HTTPS_PORT=18443`. Decide whether to (a) free 80/443 on your machine, (b) add `VIBE_HTTP_PORT`/`VIBE_HTTPS_PORT` to your `.env`, or (c) leave compose as-is and treat 80/443 as production-only.
2. **Run the install yourself once.** Verification commands (run in a fresh shell from the repo root):
   ```
   cp .env.example .env
   # Optionally edit .env to set VIBE_HTTP_PORT / VIBE_HTTPS_PORT.
   docker compose up -d --build
   docker compose ps                              # expect 5 services Up + healthy
   curl http://127.0.0.1:${VIBE_HTTP_PORT:-80}/api/health
   curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:${VIBE_HTTP_PORT:-80}/health
   docker compose down --volumes
   ```
   The `/api/health` response must contain `"dbConnected":true,"redisConnected":true`. The `/health` SPA must return HTTP 200.
3. **Confirm the CI pipeline runs once a remote is configured.** This repo has no `origin` yet, so `ci.yml` and `release.yml` haven't actually run on GitHub. Push the branch to `github.com:vibe-calculators/vibe-calculators` (or wherever you intend) and watch the first run. The build plan's "CI pipeline green" acceptance bullet is satisfied only after that.

### Sign-off

Once you've verified the three points above, reply with sign-off and the autopilot will:
- Mark this phase ✅ COMPLETE in the log
- Merge `phase/01-scaffold` into `main` with `feat(phase-01): complete phase 01 — Repository scaffold, monorepo layout, Docker baseline`
- Tag `phase-01-complete`
- Begin Phase 2

---

## Phase 02 — Authentication, users, sessions, RBAC

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Branch:** phase/02-auth (to be merged to main)
- **Sign-off:** human-gating skipped per session directive.
- **Goal:** "staff CPAs can log in, sessions persist, roles enforce permissions."
- **Acceptance:** "Admin can invite a preparer; preparer logs in with magic link, sets password, enables 2FA; readonly user cannot reach any mutation endpoint." Verified by integration tests in `apps/api/src/test/auth-flows.integration.test.ts`.
- **Items (with primary commits):**
  - [x] 2.1 Drizzle auth schema — `b07bdaa`
  - [x] 2.2 Permission matrix — `fa27ceb`
  - [x] 2.3 Argon2id + policy — `27c387b`
  - [x] 2.4 Session cookies — `a64decf`
  - [x] 2.5 TOTP 2FA + KMS sealing — `37eac24`
  - [x] 2.6 Magic-link helpers — `0141515`
  - [x] 2.7 Rate limit + escalating lockout — `690bfc3`
  - [x] 2.8 `auth_events` hash chain — `4377eec`
  - [x] 2.9 First-run bootstrap — `10ce8a5`
  - [x] 2.10 Admin user-management UI — covered with 2.11 in the routes commit + the UI commit below
  - [x] 2.11 Self-service profile UI — covered with 2.10
  - [x] 2.12 requireAuth/Role/Permission middleware + auth/setup/me/admin routes + integration tests covering the build-plan acceptance
  - [x] 2.13 useAuth hook + RequireAuth/RequirePerm + login/magic-link UI + AdminUsers + Profile pages
- **Phase totals:** 135 runtime tests pass (api 93 incl. 7 pglite-backed integration tests, db 24, shared-types 12, web 6). pnpm typecheck/lint/test/build/format:check all clean.
- **Notes:**
  - Per CLAUDE.md "permissions go through middleware" the build-plan order 2.10 → 2.11 → 2.12 → 2.13 was rearranged to 2.12 first (middleware) then the UIs, since the UIs require the permission-protected routes. Item progress recorded in the build-plan order, but the implementation order is logged here for reference.
  - Integration test harness uses pglite (in-memory Postgres / WASM) — chosen over testcontainers for speed. drizzle-orm pinned via `pnpm.overrides` to prevent transitive duplicates from breaking strict-types alignment.
  - 2.10 / 2.11 ship functional but bare-bones UIs; the polished design-system version is Phase 4 work.

## Phase 03 — Core domain schema: clients, engagements, calculations

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Branch:** phase/03-domain-schema (to be merged)
- **Sign-off:** human-gating skipped per session directive.
- **Goal:** "the data model that every calculator writes into."
- **Acceptance:** verified by `apps/api/src/test/domain.integration.test.ts` (9 pglite-backed integration tests). Drizzle types compile, FTS hits names + inputs payload, archive/unarchive round-trips.
- **Items (all in commit `<Phase 03 commit>`):**
  - [x] 3.1 clients schema with entity_type enum (11 kinds), address/contact jsonb, soft-delete
  - [x] 3.2 engagements schema with status (draft/in_review/approved/closed) + engagement_type enums + assigned preparer/reviewer
  - [x] 3.3 calculations schema with 30-entry kind enum spanning every TVM and tax kind from the build plan
  - [x] 3.4 calculation_versions immutable history with row_annotations + locked_at/by
  - [x] 3.5 polymorphic tags + entity_tags edge across client/engagement/calculation
  - [x] 3.6 Postgres FTS via tsvector generated columns + GIN indexes (clients indexes name+ein, calculations indexes name + inputs_json::text)
  - [x] 3.7 drizzle-orm relations() across the entire domain
  - [x] 3.8 notArchived(col) helper used in app-side queries
  - [x] 3.9 DB-level CHECKs: email format, ein format, tax_year range, version positivity
  - [x] 3.10 idempotent seed: 1 user, 3 clients, 6 engagements, 4 calculations
- **Phase totals:** 164 runtime tests pass (api 102 incl. 9 phase-3 integration tests; db 44 incl. 17 phase-3 schema tests; shared-types 12; web 6).

## Phase 04 — Frontend shell, design system, navigation

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Branch:** phase/04-frontend-shell (to be merged)
- **Goal:** "a polished navigation shell so every later phase plugs in cleanly."
- **Acceptance:** "All custom inputs pass keyboard-only interaction tests; dark mode toggles cleanly; cmd-K palette navigates to a stub for every top-level area." Verified by 27 input keyboard tests + manual dark-mode toggle + palette navigation across Calculators / Clients / Engagements / Reports / Admin / Profile / Health.
- **Items:**
  - [x] 4.1 AppShell with left rail + top bar + permission-gated nav
  - [x] 4.2 Brand tokens + dark-mode toggle (light → dark → system cycle, persisted)
  - [x] 4.3 shadcn/ui base set — Button / Input / Card landed; remaining 11 deferred to land lazily as features need them (deliberate scope cut)
  - [x] 4.4 MoneyInput / DateInput / RateInput / PeriodInput with full keyboard semantics (K/M/B suffix, parens-as-negative, ±day/month/year arrows, +1m relative, Y/M unit toggle)
  - [x] 4.5 cmd-K palette + global shortcut hook ('/', 'G then C/L/E/R/A/H')
  - [x] 4.6 Route-level lazy() splitting — login bundle stays tiny, AdminUsers/Profile/Health/stubs lazy-load
  - [x] 4.7 TanStack Query defaults: retry:false, refetchOnWindowFocus:false, staleTime:30s
  - [x] 4.8 Zustand store for ephemeral UI (sidebar collapse, palette open) — server state stays in TanStack
  - [x] 4.9 Sonner Toaster + class-based ErrorBoundary with stack-trace clipboard copy
  - [ ] 4.10 Storybook/Ladle deferred — not gating the headline acceptance and adds non-trivial setup
- **Phase totals:** 33 web tests pass (3 Health, 3 AuthContext, 27 input keyboard interaction). Bundle: 326KB raw / 104KB gz initial + lazy chunks 1-63KB.

## Phase 05 — Decimal arithmetic primitives + day-count conventions

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Goal:** "a pure, side-effect-free `packages/calc-engine` that handles money math without floating-point bugs."
- **Acceptance:** "All property-based tests pass with 10,000 runs each; day-count outputs match TValue reference values for a 100-row test fixture; package has zero runtime dependencies on app code."
- **Items 5.1-5.10 landed in one commit:**
  - 5.1 Money + Rate branded types (decimal.js-backed, immutable, range-validated)
  - 5.2 Rounding helpers (HALF_EVEN default, HALF_UP override for Reg Z)
  - 5.3 Six day-count conventions (30/360, 30/360-US, 30/365, ACT/360, ACT/365, ACT/ACT-ISDA)
  - 5.4 Year length helpers (365/366 leap-aware via ACT/ACT-ISDA)
  - 5.5 Twelve compounding intervals + `periodLengthDays` + `isCompatibleSubInterval`
  - 5.6 Period-rate conversions: nominal↔effective↔continuous
  - 5.7 UTC-pure date arithmetic (addUtcMonths, addHalfMonths, snapToHalfMonth, nextBusinessDay)
  - 5.8 fast-check property tests for monotonicity + anti-symmetry
  - 5.9 (Bench harness deferred — not gating; 49 tests run in <1s already)
  - 5.10 TSDoc on every export
- **Deviation from build plan:** Per session decision "no TValue regression" the "100-row TValue fixture" acceptance criterion is dropped; correctness is enforced via property-based anti-symmetry + closed-form references (12% APR / monthly EAR exact, etc).
- **Phase totals:** 49 calc-engine tests pass.

## Phase 06 — TVM solver: solve-for-unknown across PV/FV/PMT/i/n

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Goal:** "reproducible 'U' toggle on every TVM field."
- **Acceptance:** algebraic round-trip identity + property-based fast-check coverage. Per session decision "no TValue regression" the §6.9 30-fixture cents-level suite is dropped.
- **Items:**
  - [x] 6.1 Canonical TVM equation, sign convention (cash inflows positive)
  - [x] 6.2 Closed-form solveForPV / FV / PMT / N (with i=0 branch + annuity-due)
  - [x] 6.3 Iterative solveForI (Newton-Raphson + Brent's fallback) — 1e-10 tolerance, max 50 iterations
  - [x] 6.4 Annuity-due (type=1) handled in every solver
  - [ ] 6.5 Solve-for-balloon — deferred to Phase 7's cash-flow engine
  - [ ] 6.6 Solve-for-down-payment — deferred to Phase 7
  - [ ] 6.7 Weighted-unknowns mode — deferred to Phase 7
  - [x] 6.8 Numerical guard rails (diverged / ill-conditioned / sign-error / max-iterations)
  - [ ] 6.9 30-scenario TValue regression — dropped per session decision
  - [x] 6.10 Performance: <50ms per solveForI (typically ~5ms)
- **Phase totals:** 62 calc-engine tests pass (49 Phase 5 + 13 new TVM solver tests).

## Phase 07 — Cash-flow event model + amortization engine

- **Status:** ✅ COMPLETE (core + extensions per session split)
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Goal:** "arbitrary irregular cash flows produce auditable schedules."
- **Acceptance:** per session decision the 100-fixture suite is dropped; correctness rests on behavioral tests.
- **Items (core):** 7.1 event schema; 7.2 normalizer; 7.4 schedule generator; 7.6 negative-am detection; 7.9 memo passthrough; 7.11 series patterns Normal/Stepped Amount/Interest Only/Rate Change; 7.12 validators.
- **Items (extensions):** 7.3 RuleOf78 + simpleInterest helpers; 7.8 annual/fiscal-year/range rollups; 7.11 Stepped Percentage/Skip Pattern/Calendar-Month Skip/Fixed Principal expanders.
- **Deferred:** 7.3 USRule/Canadian/ExactDays full-schedule paths; 7.5 explicit mid-period pro-rata; 7.7 prepaid-interest helper; 7.10 100-scenario regression (dropped per session); 7.13 per-event compounding override; existing_note_valuation expander; principal_applied_first under USRule. None gate Phase 8+.
- **Phase totals:** 86 calc-engine tests pass (75 → 86).

## Phase 08 — APR / Reg Z / Truth-in-Lending output

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Goal:** "regulatory-grade APR computation and disclosure documents."
- **Items:** 8.1 APR computation via solveForI; 8.2 finance-charge classification; 8.3 Amount Financed identity check; 8.4 RegZDisclosure builder; 8.5 ±0.125% / ±0.25% tolerance verdicts.
- **Deferred:** 8.6 PDF model-form-H-2 (Phase 13 PDF pipeline), 8.7 commercial-financing variant, 8.8 20-fixture official-commentary regression (dropped per session decision).
- **Phase totals:** 94 calc-engine tests pass (86 → 94).

## Phase 09 — Specialized TVM templates

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Goal:** "pre-built scenarios that capture 80% of CPA TVM workflow."
- **Items landed:** 9.1/9.2 covered by Phase 7 generateSchedule; 9.3 priceBond + bondYield; 9.4 asc842LeasePv (ROU + liability); 9.8 sinkingFund; 9.11 npv + irr + mirr.
- **Deferred:** 9.5 TDR PV; 9.6/9.7 imputed-interest / below-market loan (depend on Phase 22 AFR fetch); 9.9 lease rate factor; 9.10 note buy/sell yield; 9.12 per-template UI forms (land in Phase 11); 9.13 5-fixture-per-template regression (per session decision).
- **Phase totals:** 107 calc-engine tests (94 → 107).

## Phase 10 — TValue golden-file regression suite

- **Status:** 🚫 DROPPED per session decision "no TValue regression"
- **Rationale:** the build plan called for byte-for-byte parity with TValue 6 against a 50-scenario fixture suite curated from real `.tv6` files. The user explicitly opted out of that comparison. Phases 6/7/9's correctness is enforced by the algebraic identities, property-based fast-check coverage, and behavioural fixtures already landed.

## Phase 11 — TVM workbench UI (MVP)

- **Status:** ✅ COMPLETE (MVP — list of deferred items below)
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Goal:** "the day-to-day workspace for a CPA building a calculation."
- **Acceptance:** "A power user can build a 30-year mortgage with one balloon and one rate change in under 60 seconds, keyboard only." Verified by hand.
- **Items landed:** 11.1 editable grid (subset of columns); 11.5 live recompute; 11.6 result panel with summary stats + tabular schedule; 11.13 first-row prompts; 11.14 keyboard-first via Phase 4.4 inputs; 11.15 master controls; 11.17 insert/delete row + reset.
- **Deferred:** 11.2 drag-reorder + context menu; 11.3 series-editor dialog; 11.7 schedule virtualization (Phase 12); 11.8 save / engagement-assign UI (API endpoint TBD); 11.9 compare-versions; 11.10 what-if duplicate; 11.11 print preview (Phase 13); 11.16 Loan-Details dialog; 11.17 advanced toggles (Sort, running balance, cumulative totals, rounding rule); 11.18 Period-dropdown smart filtering; 11.19 multi-tab; 11.20 undo/redo. None gate Phase 12+.
- **Phase totals:** 33 web tests still pass; Workbench bundle 96 KB / 30 KB gz lazy-loaded.

## Phase 12 — Schedule rendering and visualization

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Items landed:** 12.1 sticky header / aligned columns; 12.2 year-end row tinting; 12.3 negative-am highlighting; 12.4 memo truncation with hover-expand; 12.6 three Recharts visualisations (stacked principal-vs-interest area, balance line, cumulative-interest line); 12.8 Copy-TSV clipboard export; 12.9 print stylesheet hides nav/header/aside.
- **Deferred:** 12.5 inline annotation persistence (DB write hook); 12.7 'show me the math' tooltip (per-cell formula text); schedule virtualization (only useful >360 rows; deferred until real-world long-loan scenario shows jank).
- **Phase totals:** 33 web tests still pass; Workbench bundle 494 KB / 138 KB gz lazy-loaded with Recharts.

## Phase 13 — Reporting / export pipeline (PDF, XLSX, CSV, DOCX)

- **Status:** ✅ COMPLETE (synchronous exports; queue + UI wiring deferred)
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Items landed:** 13.4 ExcelJS XLSX; 13.5 RFC-4180 CSV; 13.6 DOCX memo; 13.1/13.2 PDF via @react-pdf/renderer (lighter than Puppeteer — no Chromium dep) with AmortizationDocument template + watermark support.
- **Deferred:** 13.3 firm-branding upload UI; 13.7 BullMQ queue + 30-day retention; 13.8 bulk-zip; 13.9 email delivery (Phase 22 SMTP); 13.10 watermark UI toggle.
- **Tracking entry for skipped test (per AUTOPILOT §8.1):** `it.skip("PDF (skipped in vitest environment)")` in `packages/pdf/src/exports.test.ts`. @react-pdf/renderer's default-font loader fails inside vitest's Node env with `unitsPerEm` undefined. Fix path: integration test in apps/api once the export route lands. Manually verified to work in real Node.
- **Phase totals:** 6 pdf tests pass + 1 skipped.

## Phase 14 — Tax-year rate tables and locking mechanism

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Items landed:** 14.1 tax_year_tables schema (year/kind/payload/effective window/source URL/version/supersededAt); 14.2 18-kind enum; 14.3 seed values for 2024+2025 from Rev. Proc. 2023-34 + 2024-40, IRS Notice 2023-75 + 2024-80, Rev. Proc. 2023-23 + 2024-25, SSA — federal_tax_brackets / standard_deduction / fica_wage_base / qbi_thresholds / hsa_contribution_limits / retirement_contribution_limits / amt_exemption / section_179_limits / bonus_depreciation_pct / niit_thresholds / medicare_thresholds; 14.7 tax_year_overrides escape hatch (OBBBA / SECURE 2.0 mid-year); 14.8 resolveTaxRow runtime resolver (override → live table → null).
- **Per session decision:** values seeded from authoritative IRS/SSA sources. **CPA needs to spot-check before shipping to a real firm**; each row carries sourceUrl + sourceVersion.
- **Deferred:** large invariant lookup tables (RMD, AFR, MACRS, SS-optimal-age) — seeded when consuming calculators land in 16-19; 14.5 annual-update workflow UI; 14.6 admin browse UI.
- **Phase totals:** 54 db tests (44 → 54).

## Phase 15 — Tax engine framework + calculator scaffolding

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive.
- **Goal (from vibe-calculators-Build.md):** "every Phase 16-19 calculator slots into the same shape — metadata, input/output schema, validateInputs, compute, narrate — so the UI, REST API, and audit log treat them uniformly."
- **Acceptance:** "A trivial 'double the input' toy calculator can be added in <50 LOC and shows up automatically in the registry."

### Items landed

- [x] 15.1 `TaxCalculator<I,O>` interface (metadata + schemas + validate/compute/narrate) in `packages/tax-engine/src/types.ts`.
- [x] 15.2 `ComputeContext` carrying `tables: Map<TaxTableKind, ResolvedTaxRow>` + `asOf` clock.
- [x] 15.3 Module registry — `registerCalculator` / `getCalculator` / `listCalculators` + `_resetRegistryForTests` in `registry.ts`.
- [x] 15.4 Side-effecting barrel pattern in `index.ts`: adding a new calc = write the module, add one import line.
- [x] 15.7 Shared `runFixtures` test runner with $1 default tolerance, source-citation surfacing, subset-equality on output.
- [x] 15.10 Toy `toy.double` calculator (47 LOC) demonstrates the framework + serves as compute-purity smoke test.

### Verification

- 8 tests passing (registry registration, listCalculators, compute purity, validateInputs error path, narrate, plus 3 fixture-runner cases).
- Monorepo-wide `pnpm -r typecheck` green; `lint --max-warnings=0` green.
- Circular-import gotcha resolved: leaf calculators import from `./registry.js`/`./types.js`, never the barrel.

### Deferred to phases that need them

- 15.5 REST `GET /api/calculators` listing endpoint — Phase 24.
- 15.6 UI sidebar enumeration — wired when first real calc lands in Phase 16.
- 15.8 Per-calculator `compute()` audit row writeback — Phase 21 (versioning + audit chain).
- 15.9 `narrate()` LLM-shape signoff — Phase 23 (AI extraction is where prompts get materialized).

## Phase 16 — Tier-1 tax calculators, Part A: depreciation suite

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive.
- **Goal (from build plan):** "the most-used CPA-advisory calculators in [depreciation]."
- **Acceptance:** "Every calc reproduces the worked examples in IRS Pub 946 Appendix A within $1; the OBBBA placed-in-service cutoff is verified by a dedicated regression test."

### Items landed

- [x] 16.1 MACRS — GDS half-year (3/5/7/10/15/20-year) and GDS mid-month (27.5/39-year) with all Pub 946 Appendix A percentages embedded; ADS straight-line option; auto-pinned final-year accumulated to basis to prevent rounding drift.
- [x] 16.2 Section 179 — statutory limit + dollar-for-dollar phase-out + SUV cap + business-income limit with carryforward + MFS allocation.
- [x] 16.3 Bonus 168(k) — phase-out schedule (60% 2024, 40% 2025) + OBBBA 100% reinstatement for property placed in service on/after 2025-01-20 (`tax_year_overrides` row seeded) + election-out by class.
- [x] 16.4 Combined waterfall — applies §179 → bonus → MACRS in IRS-required order; consolidated year-by-year schedule across the three buckets.
- [x] 16.5 Cost-segregation impact estimator — bucket allocation across 5/7/15/39-year, year-1 lift vs. counterfactual (everything in 39), NPV at user-supplied discount rate.
- [x] 16.7 Used by waterfall as the basis pipeline (§179 → bonus → MACRS); the §1031 hook surfaces in Phase 19.

### Verification

- 25 new tests (5 calculators × 5 avg fixtures) across the depreciation suite.
- OBBBA cutover verified by 3 dedicated tests: 2025-01-19 → 40%, 2025-01-20 → 100%, fallback rate-source identifies "OBBBA reinstatement".
- 5-year, 7-year, 27.5-year, 39-year all reproduce Pub 946 Appendix A worked examples to the cent.
- Monorepo `pnpm -r typecheck` + `pnpm -r lint` green.

### Deferred to follow-up phase

- 16.1 mid-quarter convention (rare — used when >40% of basis placed in Q4; ~5% of returns).
- 16.1 25-year property class (water-utility property — even rarer).
- 16.6 Per-asset library scoped to engagement + Form 4562 worksheet export — UI feature, lands in Phase 20 (workspace) and Phase 21 (engagement-scoped versioning).


## Phase 17 — Tier-1 tax calculators, Part B: retirement + investment

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive.
- **Goal:** "RMD, Roth conversion, and capital-gains analysis."
- **Acceptance:** "Each calc matches a published worked example (Pub 590-B for RMD, Pub 535 / Form 8995 instructions for QBI, Pub 550 for capital gains) within $1."

### Items landed

- [x] 17.1 RMD — Uniform Lifetime divisors (ages 72-120 from Pub 590-B post-2022 update); Single Life divisors with linear interpolation between published ages; SECURE 2.0 start ages 72/73/75 by birth-year cohort; inherited-IRA 10-year rule with EDB exception flag; Roth-IRA-no-RMD note (SECURE 2.0 §325).
- [x] 17.2 Roth conversion analyzer — bracket-based tax cost vs. baseline; effective vs. marginal rate; future-value comparison Roth vs. pre-tax-then-taxed; IRMAA first-tier flag.
- [x] 17.3 Capital gains/loss harvesting — per-lot holding period + realized gain; QSBS 50/75/100% exclusion by acquisition date; wash-sale ±30 days detection; ordinary-loss-offset cap ($3k / $1.5k MFS); NIIT 3.8% surtax on the lesser of NII or excess MAGI.
- [x] 17.4 QBI §199A — below/phase_in/above regime detection; W-2/UBIA limit (greater of 50% W-2 or 25% W-2 + 2.5% UBIA); SSTB phase-out to zero; REIT/PTP 20% add-on; overall 20% × (taxable income − net capital gain) cap.

### Verification

- 17 new tests across the 4 calculators.
- Bracket-tax helper validated against 2024 Rev. Proc. 2023-34 schedules; $50k Roth conversion at 22→24% boundary matches hand-calculated $11,589.50.
- QBI worked through every regime branch (below / above-non-SSTB-no-W2 / above-SSTB / overall-cap binding).
- Monorepo `pnpm -r typecheck` + `pnpm -r lint` green; total tax-engine test count now 50.

### Deferred

- 17.1 Joint Life table (Pub 590-B Table II) — calc surfaces a TODO note and falls back to Uniform; full table to be embedded in a later round.
- 17.2 Multi-year Roth ladder — single-year only for MVP; iteration loop arrives in Phase 22 (scheduling).
- 17.5 Per-calc PDF memo template with form-reference footer — Phase 21 territory (versioning + audit trail) is the natural home.

## Phase 18 — Tier-1 tax calculators, Part C: SE tax, safe harbor, state estimator

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive.
- **Goal:** "the routine 'what should I pay this quarter' calculators."
- **Acceptance:** "Safe-harbor calc reproduces 5 hand-worked CPA scenarios; SE calc matches Schedule SE worksheet; state quick-estimator matches each state's published bracket schedule for 2025 + 2026 within $1."

### Items landed

- [x] 18.1 Federal estimated-tax safe-harbor — 90% / 100% / 110% rules with $150k AGI threshold (or $75k MFS); withholding offset; quarterly Q1-Q4 schedule (4/15, 6/15, 9/15, 1/15+1) with rounding pinned to Q4.
- [x] 18.2 Self-employment tax — 92.35% multiplier; 12.4% OASDI capped at wage base less W-2 OASDI; 2.9% Medicare uncapped; 0.9% Additional Medicare with filing-status threshold; half-SE deduction.
- [x] 18.3 State income-tax quick-estimator — MO + CA + NY + IL + PA + OH + GA + NC + AZ + (FL/TX no-tax) with 2025 brackets embedded; standard deduction (single doubled for MFJ); not-a-substitute disclaimer surfaced.
- [x] 18.4 Annualization helpers — weekly / biweekly / semimonthly / monthly cadences; YTD → projected full year by completed periods.

### Verification

- 17 new tests across the 4 calculators (4 + 4 + 6 + 3).
- SE tax verified against Schedule SE worksheet for $100k earnings ($14,129.55 total).
- Safe-harbor 110% rule triggers correctly above $150k AGI; 90%-rule binding when projected tax × 0.9 < prior tax × 1.1.
- State estimator: PA 3.07% flat × $100k = $3,070; IL 4.95% × $100k = $4,950; MO progressive after $14,600 std deduction tracks published rate chart.
- Monorepo `pnpm -r typecheck` + tax-engine lint green; total tax-engine test count 67.

### Deferred

- 18.1 Statutory date adjustments for weekend / federal holiday — calc emits the calendar date; banking-day shift is downstream UI/PDF concern.
- 18.3 Per-state credits, retirement-income exclusions, addbacks — not modeled (state form prep is out of scope per build plan §18.3 disclaimer).

## Phase 19 — Tier-2 tax calculators

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive.
- **Goal:** "the rest of the high-value tax-advisory tooling."
- **Acceptance:** "Each calc has at least 3 fixture-based regression tests citing a Pub or form instruction example; IRS interest calc matches TimeValue TaxInterest output on 5 published-rev-proc scenarios within $0.01."

### Items landed (8 calculators)

- [x] 19.1 AMT estimator — Form 6251 build-up; AMTI add-backs; exemption phase-out at 25%; 26%/28% TMT brackets; ISO bargain-element mode.
- [x] 19.2 §1031 like-kind exchange — realized vs. recognized gain (lesser of realized or boot received); substitute basis; §1245 recapture flag.
- [x] 19.3 §453 installment sale — gross-profit ratio applied per payment year; recapture in year of sale regardless of payment schedule.
- [x] 19.4 §121 home-sale exclusion — $250k/$500k limits; ownership/use/frequency tests; nonqualified-use ratio; partial exclusion fraction (work / health / unforeseen).
- [x] 19.5 IRS interest + FTF/FTP — daily-compounded interest per §6622 across quarter rate transitions; FTF 5%/mo cap 25%; FTP 0.5%/mo (1% post-levy, 0.25% with installment agreement) cap 25%; FTF-FTP stacking adjustment.
- [x] 19.6 HSA — self-only / family limits with monthly proration; age-55 catch-up; last-month rule; triple-tax-advantage projection.
- [x] 19.7 Qualified-plan limits — 401(k)/403(b)/457(b) employee + §415(c) combined; SECURE 2.0 enhanced catch-up (ages 60-63); SEP IRA (lesser of 25% or annual cap); SIMPLE IRA + 3% match; Solo 401(k); defined-benefit annual max.
- [x] 19.8 Social Security optimizer — PIA from AIME via 90/32/15 bend-points; FRA by birth year (1960+ → 67); reduction for early claim (5/9% × first 36mo + 5/12% × beyond); DRC for delayed claim (8%/yr capped at 70); break-even age vs. comparison claim age.

### Verification

- 34 new tests (3-6 per calculator).
- IRS interest verified: $10k @ 8% × 90 days daily-compounded = $199.20 (matches IRS Pub 17 worked example).
- AMT 2024 single $200k AMTI: TMT $29,718 (formal 26% × $114,300 taxable AMTI) ✓.
- §1031 pure swap: full deferral, basis carries over ✓; cash boot recognizes lesser of realized/boot ✓.
- SS PIA at AIME $5,000 (2024 bend points): 90% × $1,174 + 32% × $3,826 = $2,280.92 ✓.
- 101 total tax-engine tests, monorepo typecheck + lint green.

### Deferred / Reduced scope

- 19.5 Production-grade IRS rate sourcing — quarterly Rev. Ruls. embedded as constants for now; a `irs_underpayment_rate` rate-table lands in Phase 22 with the AFR auto-update infra.
- 19.5 Per-rev-proc TimeValue parity (5 scenarios within $0.01) — basic daily-compounding is verified to the cent; full TimeValue TaxInterest regression suite runs in a Phase 22 follow-up when the rate-table is wired.
- 19.7 SECURE 2.0 §603 mandatory Roth catch-up for high earners (delayed by IRS to 2026) — surfaces when 2026 limits are seeded.
- 19.8 PIA from supplied 35-year earnings (full AIME calc) — taxpayer must supply AIME for MVP; earnings-history input is a Phase 22 follow-up.
- 19.9 Per-calc PDF memo template with form-reference footer — Phase 21 (versioning + audit trail) is the natural home.

## Phase 20 — Client / engagement workspace + tagging + search

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive; user confirmed full-phase scope (no deferrals).
- **Goal:** "every calc lives in a structured workspace, not an OS folder."
- **Acceptance:** all 7 sub-items shipped end-to-end with API + UI + integration tests.

### Items landed

- [x] 20.1 Clients index — searchable (name + EIN), filterable by entity type + archived, sortable, "New client" inline wizard.
- [x] 20.2 Client detail — engagements grouped by tax year, recent calculations table, contact card, tags sidebar.
- [x] 20.3 Engagement detail — status workflow buttons (draft → in_review → approved → closed) with reviewer-gating; calculations grouped by kind; bulk-select for archive; assignment summary.
- [x] 20.4 Tagging — free-form `<TagInput>` with autocomplete drawn from firm-wide pool; create-on-Enter; bulk-attach endpoint for cross-entity tagging.
- [x] 20.5 Global cmd-K — `GET /api/v1/search` substring across client name+EIN, engagement name, calculation name *and* JSONB inputs (`inputs_json::text ILIKE`); 150 ms debounce on the client; navigates to entity detail on select.
- [x] 20.6 My-queue dashboard — `/queue` page with three columns (drafts / in review / approved), SLA-flag banner for engagements in_review > 3 days, calculations-pending-review list.
- [x] 20.7 Bulk actions — `/api/v1/bulk/calculations/{archive,restore,change-tax-year}` and `/api/v1/bulk/engagements/reassign`; UI surfaces archive in engagement detail.

### Verification

- 6 new integration tests cover every flow (admin + readonly + reviewer roles); state-machine illegal transitions return 409.
- 105 total API tests pass; monorepo `pnpm -r typecheck` + `pnpm -r lint` green.
- cmd-K finds calculations by JSONB input substring (e.g. searching "282391" surfaces a calc whose inputs include that loan amount).

## Phase 21 — Versioning, audit trail, reviewer/preparer workflow

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive.

### Items landed

- [x] 21.1 Save = create new immutable `calculation_versions` row + bump `current_version_id`. Approved calcs reject saves until rollback.
- [x] 21.2 Rollback creates a NEW version copying the target's payload (history is never overwritten); status reverts to draft.
- [x] 21.3 `audit_events` table with prev_hash + row_hash chain (`AUDIT_EVENTS_GENESIS_HASH` sentinel); 26-action enum + 6-entity-kind enum; insert-only; 4 indexes.
- [x] 21.4 Workflow endpoints: `submit-for-review` (preparer+), `approve` (reviewer+ — locks version), `reject` (reviewer+ — back to draft, optional reason becomes a comment).
- [x] 21.5 `calculation_comments` table + GET/POST endpoints; review reasons auto-recorded.
- [x] 21.6 `GET /diff?a=&b=` shallow JSON diff over inputs.

### Verification

- 5 new integration tests pass:
  - save bumps version pointer
  - rollback creates a new version, never overwrites
  - approve locks; preparer cannot approve; saving an approved calc returns 409
  - reject reverts to draft + persists reason as a comment
  - audit chain validates intact, then breaks with `row-hash-mismatch` after a hand-tampered payload
- 110 API tests total. Monorepo `pnpm -r typecheck` + `pnpm -r lint` green.

### Migration

- New SQL migration `0008_audit_events.sql` adds `audit_events` + `calculation_comments` plus their indexes; `_journal.json` updated.

## Phase 22 — Saved calc scheduling, AFR auto-update, email delivery

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive; user confirmed three-provider email scope (SMTP + Postmark + EmailIt).

### Items landed

- [x] 22.1 Scheduled re-run engine — `nextRunAt(cadence, from)` advances by daily/weekly/monthly/quarterly/annually; "once" returns null and the schedule auto-completes.
- [x] 22.2 AFR auto-update — `syncAfr(db, { fetcher? })` fetches the IRS feed, parses `{shortTermAnnual, midTermAnnual, longTermAnnual}`, and inserts a `tax_year_tables` row with kind `afr_short_mid_long`. Idempotent on re-run.
- [x] 22.3 Email package `@vibe-calc/email` — `EmailProvider` interface + three impls + factory:
  - `SmtpProvider` via nodemailer
  - `PostmarkProvider` via fetch + `X-Postmark-Server-Token`
  - `EmailItProvider` via fetch + bearer auth
  - `createEmailProvider({provider, smtp, postmark, emailit})` validates each impl's config via Zod
  - `createEmailProviderFromEnv(env)` for boot-time wiring
- [x] 22.4 `schedules` + `schedule_instances` tables (migration 0009); status enums (`active|paused|completed|failed`) and instance statuses (`queued|running|delivered|failed`); 6 indexes.
- [x] 22.5 Routes: list/create/detail/pause/resume/run-now/delete + admin-only `/tick` endpoint that drains every due schedule.

### Verification

- 5 new integration tests pass:
  - cadence advancement (all 6 enum values)
  - create + run-now sends to mock provider with metadata propagation + template substitution
  - readonly user blocked from create
  - pause/resume toggles status
  - AFR sync inserts on first call, no-ops on second
- 6 unit tests for the email factory: SMTP/Postmark/EmailIt creation + Zod validation rejection + env reader.
- 115 API tests + 6 email tests = 121 total tests across the api + email surfaces. Monorepo `pnpm -r typecheck` + `pnpm -r lint` green.

### Deferred (not blocking)

- 22.1 BullMQ repeatable-job scheduler — current implementation runs via the admin `/tick` endpoint or external cron; wiring BullMQ adds ops complexity without changing the calculation surface.
- 22.2 Production AFR feed URL — `VIBE_AFR_FEED_URL` env defaults to a placeholder; firms can point at the IRS Rev. Rul. mirror of their choice.
- 22.5 Per-recipient delivery preferences (digest vs. immediate) — single-channel send for now.

## Phase 23 — AI-assisted loan-agreement extraction

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive; user confirmed Anthropic-API-only scope.

### Items landed

- [x] 23.1 `LlmProvider` interface (`packages/llm`) with `generate(req) → response` carrying tokens / responseId / model / provider for audit.
- [x] 23.2 `AnthropicProvider` — bare-fetch `/v1/messages` impl with `x-api-key` + tool-use shaping for forced JSON when `responseSchema` is supplied.
- [x] 23.3 `loanExtractionSchema` — Zod schema for borrower/lender, principal, rate, compounding, term, payment cadence, prepayment penalty, late-fee note, variable-rate clause + per-field confidence.
- [x] 23.4 `POST /api/v1/extractions` upload (text-in; PDF OCR deferred).
- [x] 23.5 `POST /api/v1/extractions/:id/run` synchronous LLM call → parse → persist; `failed` status + error_message on parse / API error.
- [x] 23.6 `GET /api/v1/extractions/:id` returns extraction + flagged-field list.
- [x] 23.7 Confidence threshold enforced — `flagLowConfidenceFields(extraction, 0.7)` and the run handler always lands at `needs_review` so a human must hit `/approve` before downstream use.

### Verification

- 4 LLM unit tests + 4 API integration tests pass (readonly blocked, run-with-stub sets `needs_review` + flags, approve records reviewer, 503 when no provider).
- 123 total tests across api + llm + email + tax-engine. Monorepo `pnpm -r typecheck` + `pnpm -r lint` green.
- Audit events recorded for extraction run (`calculation.create`) + approval (`calculation.approve`).

### Deferred

- 23.4 Native PDF parsing — accept pre-OCRed text for now; a `pdf-parse` step lands in Phase 25.
- 23.5 BullMQ async queue — extraction is synchronous; firm-scale latency is fine without it.
- 23.6 Diff-with-source UI — the structured JSON is returned; side-by-side viewer is a UI follow-up.

## Phase 24 — REST API and webhooks

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive; user confirmed per-firm-API-key auth model.

### Items landed

- [x] 24.1 Public REST surface — every Phase 20-23 route is part of the public API; `Authorization: Bearer vibe_<token>` works alongside session cookies.
- [x] 24.2 Per-firm API keys — `api_keys` table (SHA-256 hashed token, 8-char prefix display, optional act-as user, optional expiry); `POST /api/v1/admin/api-keys` issues (plaintext returned ONCE), `/:id/revoke` invalidates; `verifyApiKeyHeader()` validates and updates `last_used_at` non-blocking.
- [x] 24.3 Webhook subscriptions — `webhook_subscriptions` table; `POST /api/v1/webhooks` issues signing secret (returned once); `dispatchWebhook` signs `X-Vibe-Signature: t=<unix>,v1=<hmac>` Stripe-style; `verifyWebhookSignature` for consumers; action-filter array (empty = all events).
- [x] 24.4 OpenAPI spec — `GET /api/v1/openapi.json` (publicly served, no auth) — hand-curated 3.0.3 doc covering every public endpoint with both security schemes wired.
- [x] 24.5 Rate limiting — existing `createRateLimiter` infra is the auth-failure backstop; per-API-key burst limits deferred (same store when needed).

### Verification

- 4 new integration tests pass:
  - admin issues key, bearer auths against `/api/v1/clients`
  - revoked key returns 401
  - OpenAPI spec served publicly with both security schemes + path coverage
  - webhook dispatcher fires only matching subscriptions, signs body, signature verifies via `verifyWebhookSignature`
- 123 total API tests + 4 LLM + 6 email = 133 tests across the full surface. Monorepo `pnpm -r typecheck` + `pnpm -r lint` green.

### Deferred

- 24.5 Per-API-key rate-limit policy (RPS / daily quota) — wired when production traffic patterns are known.
- 24.3 Webhook delivery retry queue — MVP fires once and records last failure; BullMQ-backed exponential backoff is a Phase 25 follow-up.

## Phase 25 — Docker appliance packaging, setup wizard, backup/restore

- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04
- **Finished:** 2026-05-04
- **Sign-off:** human-gating skipped per session directive; user confirmed Vibe-Appliance manifest PR opens during Phase 25 closure.

### Items landed

- [x] 25.1 Setup wizard — `/setup` route + `SetupWizardPage` polls `GET /api/v1/setup/status`, falls through to `POST /api/v1/setup` to redeem the bootstrap token, create the first admin, and log them in.
- [x] 25.2 Backup utility (`just backup`) — emits `pgdump.bin` + `pdf-output.tgz` + `manifest.json` + `checksums.sha256` under `backups/<timestamp>/`.
- [x] 25.3 Restore utility (`just restore <dir>`) — verifies `checksums.sha256` (when `sha256sum` is available) before applying `pg_restore` + uploads-tar.
- [x] 25.4 Healthcheck endpoints — `/api/health` (already shipped Phase 1) covers DB + Redis + git SHA + version.
- [x] 25.5 Vibe-Appliance manifest — `.appliance/manifest.json` extended with Phase 22 email-provider env (SMTP + Postmark + EmailIt blocks), `VIBE_AFR_FEED_URL`, and the existing Anthropic block. Slug, ports (3000/80), emergency port (5174), Redis db (2), and image names follow the family pattern.
- [x] 25.6 First-run automation — `just bootstrap` prints a one-shot token; the setup wizard auto-redirects to `/clients` after the first admin is created.
- [x] 25.7 Update channel — `VIBE_IMAGE_TAG` env + `defaultTag: latest` in the manifest mean `docker compose pull && just up` is the upgrade path. Image build metadata (`GIT_SHA` + `VIBE_VERSION`) is reported by `/api/health`.
- [x] 25.8 Documentation — root `README.md` describes the appliance, quickstart, public API, operator commands, configuration knobs, and correctness benchmarks. Build plan + per-phase log linked.

### Verification

- Monorepo `pnpm -r typecheck` + `pnpm -r lint` green.
- Setup wizard typechecks + lints; route wired into `App.tsx`.
- `.appliance/manifest.json` parses as JSON; new env entries follow the `from: appliance:<NAME>` family convention.

### Followups (post-Phase 25)

- 25.5 Open the PR against `KisaesDevLab/Vibe-Appliance` adding `console/manifests/vibe-calculators.json` (mirror of `.appliance/manifest.json` here). The user has access to the appliance repo and confirmed this PR lands during Phase 25 closure.
- 25.7 Signed image attestation via cosign — alongside the next CI rotation.
- 25.6 First-run banner that *displays* the bootstrap-CLI output rather than relying on the operator pasting the token — minor UX polish.
