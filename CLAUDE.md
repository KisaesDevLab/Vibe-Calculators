# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This is a **pre-implementation** repository. The only artifact is `vibe-calculators-Build.md` — a 25-phase build plan that is the authoritative spec for everything to be built. There is no code, no `package.json`, no Docker config yet; the git repo has no commits.

When working here, **always read `vibe-calculators-Build.md` first**. It contains acceptance criteria, schema sketches, regression-fixture targets, and per-phase deliverables that other instructions assume. Treat it as source-of-truth — if a request conflicts with it, surface the conflict rather than silently diverging.

## Product

Vibe Calculators is a self-hosted Docker appliance for CPA firm staff providing:
- TValue-grade time-value-of-money / loan amortization calculations
- A tax-advisory calculator suite (depreciation, RMD, Roth, QBI, AMT, 1031, SE tax, safe harbor, etc.)
- AI-assisted loan-agreement extraction (Phase 23, deferred)

Audience is staff CPAs inside a single firm. Multi-user concurrent; no client portals.

## Architecture (intended)

Monorepo with pnpm workspaces:
- `apps/web` — React 18 + TypeScript + Vite + Tailwind + shadcn/ui
- `apps/api` — Node 20 + Express + Drizzle ORM
- `packages/calc-engine` — pure TVM math (no Express/React/DB deps)
- `packages/tax-engine` — tax calculators implementing a uniform `TaxCalculator<I,O>` interface
- `packages/shared-types` — Zod schemas + inferred TS types, including the permission matrix
- `packages/db` — Drizzle schema + migrations (Postgres 16)
- `packages/pdf` — Puppeteer/ExcelJS/docx export pipeline
- `packages/llm` (Phase 23+) — `LLMProvider` interface; Anthropic + local Qwen3-8B providers

Infrastructure: Postgres 16, Redis 7 + BullMQ, Caddy as sole ingress with three deploy modes (`domain` / `lan` / `tailscale`) selected by `VIBE_DEPLOY_MODE`.

## Load-bearing conventions

These rules are non-negotiable across the codebase:

- **No floats for money or rates, ever.** Use `Money` and `Rate` branded types built on `decimal.js`. A lint rule must reject `parseFloat`/`parseInt`/`Number` for currency/interest math in `packages/calc-engine` and `packages/tax-engine`.
- **Zod at every boundary** (HTTP, DB read, queue payload). TypeScript types are *inferred* from Zod schemas — never hand-write a parallel interface.
- **Permissions go through middleware** (`requireAuth`, `requireRole`, `requirePermission`). Never check roles inline in route handlers. The permission matrix is a single source-of-truth object in `packages/shared-types/permissions.ts`.
- **Soft delete** (`archived_at`) on every user-facing entity. Hard-delete only via admin tool.
- **Versioning is immutable.** Every save creates a `calculation_versions` row; `calculations.current_version_id` is the pointer. Rollback creates a *new* version, never overwrites.
- **Audit events are tamper-evident.** Each `audit_events` row contains a hash of the previous row. Insert-only, never editable.
- **Time:** UTC in storage, firm-timezone in UI. Use `date-fns-tz`. Never `Date.parse(string)` — always explicit ISO with timezone.
- **Errors:** All errors classed via a `VibeError` discriminated union; HTTP maps to RFC 7807. No stack traces in prod responses.
- **Logging:** Pino structured JSON, per-request correlation ID propagated to workers, PII redaction (SSN/EIN/full name) by default.

## Correctness benchmarks

- **TVM math:** byte-for-byte parity with TValue 6 against the 50-scenario regression suite built in Phase 10. CI gate — failure blocks merge.
- **Tax math:** parity within $1 against worked examples in IRS Pub 17, 535, 550, 590-B, 946; Forms 1040-ES, 4562, 4972, 6251, 8606, 8915, 8960, 8995/8995-A, W-4 (2020+).
- **Tax-year reproducibility:** every tax calculation persists the `tax_year_tables` row IDs it consumed. Recomputing a 2024-tax-year calc in 2026 must produce the identical 2024 result.
- **Coverage:** ≥80% line coverage on `calc-engine` and `tax-engine`. Property-based tests (`fast-check`) for math primitives. Fixture-based tests for every calculator.

## UI / IP rule (applies to every phase)

Implement the **functional capabilities** described in the plan but **do not replicate** TValue's, TCalc's, or any other product's visual design — layout, color palette, iconography, ribbon/toolbar arrangement, idiosyncratic labels, look-and-feel. Numerical outputs should match TValue cents-level (that's correctness verification, not infringement); presentation must be Vibe's own design.

Where the plan references a screenshot or external product to communicate a *capability*, that's informational only. Industry-standard terminology ("Interest Only", "Skip Series", "Rate Change") is fine; product-idiosyncratic labels are not.

## Phase gating

Each phase ends with a written acceptance check. **Do not advance to phase N+1 until phase N's acceptance check is signed off in `PHASE_LOG.md`.** When asked to implement work, confirm which phase it belongs to and whether predecessor phases are complete before starting.

## Out of scope (do not build)

- Commercial licensing, Stripe, license keys, per-tier enforcement
- Client-facing portals
- **Transactional loan servicing** — ACH/EFT, automated payment posting, borrower-facing portals, escrow admin, lockbox. The line: *modeling cash flows on a schedule = in scope*; *moving real money or tracking real-world payment receipts = out of scope*. Custom event-line entry (hand-entered Payment $282.39 on 1/3/2031) is firmly in scope.
- Mobile companion app

## Operator workflow (when present)

Once Phase 1 lands, common commands will live in a `justfile`: `just up`, `down`, `logs`, `shell-api`, `psql`, `migrate`, `seed`, `reset-db`, `backup`, `restore`, `test`, `e2e`. Until then, there is nothing to run.
