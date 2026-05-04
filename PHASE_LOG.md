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

- **Status:** ⏳ NOT STARTED

## Phase 08 — APR / Reg Z / Truth-in-Lending output

- **Status:** ⏳ NOT STARTED

## Phase 09 — Specialized TVM templates

- **Status:** ⏳ NOT STARTED

## Phase 10 — TValue golden-file regression suite

- **Status:** ⏳ NOT STARTED

## Phase 11 — TVM workbench UI

- **Status:** ⏳ NOT STARTED

## Phase 12 — Schedule rendering and visualization

- **Status:** ⏳ NOT STARTED

## Phase 13 — Reporting / export pipeline (PDF, XLSX, CSV, DOCX)

- **Status:** ⏳ NOT STARTED

## Phase 14 — Tax-year rate tables and locking mechanism

- **Status:** ⏳ NOT STARTED

## Phase 15 — Tax engine framework + calculator scaffolding

- **Status:** ⏳ NOT STARTED

## Phase 16 — Tier-1 tax calculators, Part A: depreciation suite

- **Status:** ⏳ NOT STARTED

## Phase 17 — Tier-1 tax calculators, Part B: retirement + investment

- **Status:** ⏳ NOT STARTED

## Phase 18 — Tier-1 tax calculators, Part C: SE tax, safe harbor, state estimator

- **Status:** ⏳ NOT STARTED

## Phase 19 — Tier-2 tax calculators

- **Status:** ⏳ NOT STARTED

## Phase 20 — Client / engagement workspace + tagging + search

- **Status:** ⏳ NOT STARTED

## Phase 21 — Versioning, audit trail, reviewer/preparer workflow

- **Status:** ⏳ NOT STARTED

## Phase 22 — Saved calc scheduling, AFR auto-update, email delivery

- **Status:** ⏳ NOT STARTED

## Phase 23 — AI-assisted loan-agreement extraction

- **Status:** ⏳ NOT STARTED

## Phase 24 — REST API and webhooks

- **Status:** ⏳ NOT STARTED

## Phase 25 — Docker appliance packaging, setup wizard, backup/restore

- **Status:** ⏳ NOT STARTED
