# Vibe Calculators — Phase Log

This log is the single source of truth for build progress, per AUTOPILOT.md §10.
Append-only — never delete prior entries.

Status legend: `⏳ NOT STARTED`, `🚧 IN PROGRESS`, `🛑 BLOCKED (awaiting human)`, `✅ COMPLETE`.

---

## Phase 01 — Repository scaffold, monorepo layout, Docker baseline

- **Status:** 🚧 IN PROGRESS
- **Started:** 2026-05-04
- **Branch:** phase/01-scaffold
- **Goal (from vibe-calculators-Build.md):** "a `docker compose up` that boots an empty but healthy app shell with frontend + backend + Postgres + Redis + Caddy."
- **Acceptance (from vibe-calculators-Build.md):** "`just up` on a fresh laptop produces a working `/health` page; `/api/health` reports DB and Redis connected; CI pipeline green."
- **Items:**
  - [ ] 1.1 Monorepo with pnpm workspaces (apps/web, apps/api, packages/calc-engine, packages/tax-engine, packages/shared-types, packages/db, packages/pdf)
  - [ ] 1.2 Root `package.json` with `engines.node: ">=20.11"`, `pnpm@9` as `packageManager`
  - [ ] 1.3 Root `tsconfig.base.json` with strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, path aliases
  - [ ] 1.4 ESLint flat config + Prettier; pre-commit hook via `simple-git-hooks` running `lint-staged`
  - [ ] 1.5 `apps/web` Vite + React 18 + TS + Tailwind + shadcn/ui scaffold with placeholder `/health` page
  - [ ] 1.6 `apps/api` Express + TS scaffold with `/api/health` returning `{status, version, gitSha, dbConnected, redisConnected}`
  - [ ] 1.7 `packages/db` Drizzle setup pointing at Postgres 16 with first migration creating `_meta` table
  - [ ] 1.8 Multi-stage Dockerfile for `apps/api` (pnpm fetch → build → distroless runtime)
  - [ ] 1.9 Dockerfile for `apps/web` (Vite build → static assets served by Caddy)
  - [ ] 1.10 `docker-compose.yml` with services: `caddy`, `web`, `api`, `postgres`, `redis`; named volumes
  - [ ] 1.11 `Caddyfile` with three modes selected by `VIBE_DEPLOY_MODE`
  - [ ] 1.12 `.env.example` with every required variable; `apps/api` validates env at boot via Zod
  - [ ] 1.13 `justfile` with: up, down, logs, shell-api, psql, migrate, seed, reset-db, backup, restore, test, e2e
  - [ ] 1.14 GitHub Actions: ci.yml + release.yml

### Naming convention note (build-plan reference)

AUTOPILOT.md refers to `CLAUDE.md` as the "authoritative build plan". In this repository the phase definitions and acceptance criteria live in `vibe-calculators-Build.md`; `CLAUDE.md` is the orientation/conventions doc that points at it. All phase quotes in this log are taken from `vibe-calculators-Build.md` and treated as authoritative per AUTOPILOT §1. Flagged for human awareness; proceeding under that interpretation.

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
