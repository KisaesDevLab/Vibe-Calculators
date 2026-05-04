# Vibe Calculators — Phase Log

This log is the single source of truth for build progress, per AUTOPILOT.md §10.
Append-only — never delete prior entries.

Status legend: `⏳ NOT STARTED`, `🚧 IN PROGRESS`, `🛑 BLOCKED (awaiting human)`, `✅ COMPLETE`.

---

## Phase 01 — Repository scaffold, monorepo layout, Docker baseline

- **Status:** 🛑 BLOCKED (awaiting human sign-off — Phase 1 is in §9)
- **Started:** 2026-05-04
- **Finished (autopilot):** 2026-05-04
- **Branch:** phase/01-scaffold (not yet merged to main)
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

- **Status:** ⏳ NOT STARTED

## Phase 03 — Core domain schema: clients, engagements, calculations

- **Status:** ⏳ NOT STARTED

## Phase 04 — Frontend shell, design system, navigation

- **Status:** ⏳ NOT STARTED

## Phase 05 — Decimal arithmetic primitives + day-count conventions

- **Status:** ⏳ NOT STARTED

## Phase 06 — TVM solver: solve-for-unknown across PV/FV/PMT/i/n

- **Status:** ⏳ NOT STARTED

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
