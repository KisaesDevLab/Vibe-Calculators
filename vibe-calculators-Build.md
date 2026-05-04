# Vibe Calculators — Build Plan

**Product:** Self-hosted Docker appliance providing TValue-grade time-value-of-money / loan amortization calculations plus a tax-advisory calculator suite for CPA firm staff.

**Audience:** Staff CPAs doing client advisory work inside a single firm. Multi-user concurrent access within the firm; no client-portal access in scope.

**Tech stack (matches the broader Vibe family):**
- Frontend: React 18 + TypeScript + Vite + Tailwind + shadcn/ui
- Backend: Node.js 20 + Express + Drizzle ORM
- Database: PostgreSQL 16
- Cache / jobs: Redis 7 + BullMQ
- Math: `decimal.js` (no floats for currency / interest math, ever)
- Auth: session-based + Argon2id + magic-link option (no SSO MVP)
- Reporting: Puppeteer (PDF) + ExcelJS (XLSX) + docx (DOCX)
- AI (optional, Phase 23): Anthropic API (cloud, Tier 2) with optional local Qwen3-8B (Tier 1) via vibe-llm-server
- Container: Docker Compose, Caddy as sole ingress
- Deploy targets: domain mode, LAN mode, Tailscale mode (consistent with Vibe Appliance pattern)

**Out of scope for this plan:**
- Commercial licensing / Stripe / per-tier enforcement / license keys / grace periods
- Client-facing portals
- **Transactional loan servicing** — ACH/EFT processing, automated payment posting via bank rails, payment receipt issuance, borrower-facing payment portals, escrow account administration, lockbox integration. Vibe Calculators is a modeling and analysis tool, not a servicing system. **Important clarification:** arbitrary custom event-line entry (e.g., entering Payment $282.39 on 1/3/2031 as a single line) **is fully in scope** — that is core TVM modeling, not "servicing." A staff CPA can hand-enter, edit, insert, delete, sort, expand, or compress any event row on any date with any amount. The line between "in scope" and "out of scope" is whether the appliance is *moving real money or tracking real-world payment receipts* (out of scope) versus *modeling cash flows on a schedule* (very much in scope).
- Mobile companion app

**UI / intellectual-property principle (applies to every phase):**
Vibe Calculators must implement the **functional capabilities** described in this plan but must **not** replicate any other product's user interface, visual design, layout, color palette, iconography, ribbon/toolbar arrangement, specific control labeling, or overall look-and-feel. Functional features and industry-standard financial concepts are not protectable; specific visual presentation can be. Therefore:
- The screen layout, navigation pattern, color scheme, typography, and iconography are **Vibe's own design**, consistent with the rest of the Vibe product family — not a clone of TValue, TCalc, or any other commercial calculator product.
- Where this plan references a screenshot or an existing product to communicate a *capability* to Claude Code, that reference is informational only; the implementation must arrive at its own visual treatment.
- Output **mathematical results** are expected to match TValue 6 cents-level (matching numerical output is correctness verification against the de-facto industry reference; that is not infringement). UI presentation must not.
- Where industry-standard terminology exists for a feature (e.g., "Interest Only," "Skip Series," "Rate Change"), that terminology is acceptable. Where a label is idiosyncratic to one product, use a generic descriptive alternative.

**Authoritative correctness benchmarks:**
- TVM math: byte-for-byte parity with TValue 6 against a 50-scenario regression suite (built in Phase 10)
- Tax math: parity with worked examples from IRS Pub 946, Form 1040-ES, Form 4562, Form 4972, Form 8606, Form 8915, Form 6251, Form 8960, Form 8995/8995-A, Form 1040-SS, Form W-4 (2020+)

**Phase gating rule:**
Every phase ends with a written acceptance check. Do not advance to phase N+1 until phase N's acceptance check is signed off in `PHASE_LOG.md`.

---

## Phase 1 — Repository scaffold, monorepo layout, Docker baseline

Goal: a `docker compose up` that boots an empty but healthy app shell with frontend + backend + Postgres + Redis + Caddy.

- [ ] 1.1 Create monorepo with pnpm workspaces: `apps/web`, `apps/api`, `packages/calc-engine`, `packages/tax-engine`, `packages/shared-types`, `packages/db`, `packages/pdf`
- [ ] 1.2 Root `package.json` with `engines.node: ">=20.11"`, `pnpm@9` as `packageManager`
- [ ] 1.3 Root `tsconfig.base.json` with strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, path aliases for each workspace package
- [ ] 1.4 ESLint flat config + Prettier; pre-commit hook via `simple-git-hooks` running `lint-staged`
- [ ] 1.5 `apps/web` Vite + React 18 + TS + Tailwind + shadcn/ui scaffold with placeholder `/health` page
- [ ] 1.6 `apps/api` Express + TS scaffold with `/api/health` returning `{status, version, gitSha, dbConnected, redisConnected}`
- [ ] 1.7 `packages/db` Drizzle setup pointing at Postgres 16 with first migration that creates `_meta` table holding schema version and bootstrap timestamp
- [ ] 1.8 `Dockerfile` for `apps/api` (multi-stage; pnpm fetch → build → distroless runtime)
- [ ] 1.9 `Dockerfile` for `apps/web` (Vite build → static assets served by Caddy)
- [ ] 1.10 `docker-compose.yml` with services: `caddy`, `web`, `api`, `postgres`, `redis`; named volumes for `pgdata`, `redisdata`, `pdf-output`
- [ ] 1.11 `Caddyfile` with three modes selected by `VIBE_DEPLOY_MODE` env: `domain` (auto-HTTPS via ACME), `lan` (HTTP on :80), `tailscale` (HTTPS via Tailscale serve)
- [ ] 1.12 `.env.example` with every required variable; `apps/api` validates env at boot via Zod and exits with a clear error on missing values
- [ ] 1.13 `justfile` with: `up`, `down`, `logs`, `shell-api`, `psql`, `migrate`, `seed`, `reset-db`, `backup`, `restore`, `test`, `e2e`
- [ ] 1.14 GitHub Actions: `ci.yml` runs lint + typecheck + unit tests on every push; `release.yml` builds and pushes images to GHCR with OCI labels and `latest` + git-sha tags

**Acceptance:** `just up` on a fresh laptop produces a working `/health` page; `/api/health` reports DB and Redis connected; CI pipeline green.

---

## Phase 2 — Authentication, users, sessions, RBAC

Goal: staff CPAs can log in, sessions persist, roles enforce permissions.

- [ ] 2.1 Drizzle schema: `users` (id, email, name, password_hash, role, status, created_at, last_login_at, totp_secret, totp_enabled), `sessions` (id, user_id, expires_at, ip, user_agent), `password_reset_tokens`, `magic_link_tokens`
- [ ] 2.2 Roles: `admin`, `reviewer`, `preparer`, `readonly`. Permission matrix encoded as a single source-of-truth object in `packages/shared-types/permissions.ts`
- [ ] 2.3 Argon2id password hashing (memory=64MB, iterations=3, parallelism=4); password policy: min 12 chars, blocked-common-passwords list, optional zxcvbn score ≥ 3
- [ ] 2.4 Session cookies: HttpOnly, Secure (in domain mode), SameSite=Lax, 30-day rolling expiration with absolute 90-day max
- [ ] 2.5 TOTP 2FA (RFC 6238) with QR enrollment; recovery codes (10 single-use); 2FA may be required by admin policy
- [ ] 2.6 Magic-link login (15-min expiration, single-use, IP-bound) as alternative for users without password
- [ ] 2.7 Login rate limit: 5 attempts / 15 min / IP+email pair; lockout escalation; admin can clear lockouts
- [ ] 2.8 Audit log table `auth_events` capturing logins, logouts, password changes, 2FA enable/disable, lockouts (used by Phase 21 audit trail)
- [ ] 2.9 First-run bootstrap: if no users exist, expose a one-time setup token printed to API logs that creates the first admin
- [ ] 2.10 Admin user-management UI: invite (email + role), suspend, reset password, force 2FA, view last login
- [ ] 2.11 Self-service: change password, set up 2FA, manage active sessions (revoke), profile name/email
- [ ] 2.12 Express middleware: `requireAuth`, `requireRole(role)`, `requirePermission(perm)` — all permission checks go through this middleware, never inline
- [ ] 2.13 Frontend: `useAuth()` hook + `<RequireAuth>` and `<RequirePerm>` components

**Acceptance:** Admin can invite a preparer; preparer logs in with magic link, sets password, enables 2FA; readonly user cannot reach any mutation endpoint (verified by integration tests for every route).

---

## Phase 3 — Core domain schema: clients, engagements, calculations

Goal: the data model that every calculator writes into.

- [ ] 3.1 `clients` (id, name, entity_type, ein, address_json, primary_contact_json, tags, archived_at, created_by, created_at, updated_at)
- [ ] 3.2 `engagements` (id, client_id, name, tax_year, engagement_type, status [draft/in_review/approved/closed], assigned_preparer, assigned_reviewer, archived_at, timestamps)
- [ ] 3.3 `calculations` (id, engagement_id?, client_id?, kind, name, inputs_json, outputs_json, computed_at, computed_by, version, parent_id [for fork-and-tweak], status [draft/ready_for_review/approved], tags, archived_at)
- [ ] 3.4 `calculation_versions` table — every save creates an immutable version row; current pointer lives on `calculations.current_version_id`
- [ ] 3.5 `tags` table + `entity_tags` join (polymorphic via `entity_type` + `entity_id`)
- [ ] 3.6 Postgres full-text index (tsvector) on `clients.name`, `engagements.name`, `calculations.name`, `calculations.inputs_json::text`
- [ ] 3.7 Drizzle relations + typed query helpers in `packages/db`
- [ ] 3.8 Soft-delete pattern (`archived_at`) on every user-facing entity; hard-delete only via admin tool
- [ ] 3.9 Migration adds DB-level CHECK constraints on enum-like columns
- [ ] 3.10 Seed script for development: 3 clients, 6 engagements, varied calculations across kinds

**Acceptance:** Drizzle types compile cleanly; full-text search query returns expected hits across name + inputs payload; archive/unarchive round-trips correctly.

---

## Phase 4 — Frontend shell, design system, navigation

Goal: a polished navigation shell so every later phase plugs in cleanly.

- [ ] 4.1 Top-level layout: left rail (Calculators / Clients / Engagements / Reports / Admin), top bar (firm logo, search, user menu), main content
- [ ] 4.2 Tailwind theme aligned with Vibe brand tokens (extract from existing Vibe MyBooks if available); CSS variables for light + dark mode
- [ ] 4.3 shadcn/ui base set: Button, Input, Select, Combobox, Dialog, Sheet, Tabs, Tooltip, Toast, Table, DropdownMenu, Form, Calendar, Popover, Card
- [ ] 4.4 Custom components: `<MoneyInput>` (decimal.js-backed, supports K/M/B suffix), `<DateInput>` (smart date entry — typing "010125" auto-formats to 01/01/2025; arrow keys adjust day/month/year), `<RateInput>` (% with 6-decimal precision), `<PeriodInput>` (12Y → months toggle)
- [ ] 4.5 Global keyboard shortcuts (cmd-K command palette, "/" focus search, "G then C" → Calculators, etc.)
- [ ] 4.6 React Router v6 with file-based route module convention; route-level code splitting
- [ ] 4.7 TanStack Query v5 for all server state with sensible defaults (`staleTime: 30s`, automatic refetch on window focus disabled in calculator pages)
- [ ] 4.8 Zustand for ephemeral UI state only (modal open, sidebar collapsed) — never for server data
- [ ] 4.9 Toast + error-boundary patterns wired globally; unhandled errors surface a "Report issue" link with stack-trace copy
- [ ] 4.10 Storybook (or Ladle) running for the custom input components — these are the foundation and need visual regression

**Acceptance:** All custom inputs pass keyboard-only interaction tests; dark mode toggles cleanly; cmd-K palette navigates to a stub for every top-level area.

---

## Phase 5 — Decimal arithmetic primitives + day-count conventions

Goal: a pure, side-effect-free `packages/calc-engine` that handles money math without floating-point bugs.

- [ ] 5.1 Wrap `decimal.js` with a `Money` type and `Rate` type — both branded TS types, both immutable; constructors validate range
- [ ] 5.2 Currency rounding helpers (HALF_UP, HALF_EVEN); default HALF_EVEN ("banker's rounding") with HALF_UP override for Reg Z disclosures
- [ ] 5.3 Day-count conventions module with pure functions: `days30_360(d1, d2)`, `daysActual365(d1, d2)`, `daysActual360(d1, d2)`, `days30_365(d1, d2)`, `daysActualActualISDA(d1, d2)`
- [ ] 5.4 Year-length helper supporting 360, 364, 365 (and 365.25 for continuous-comparison reference only — not selectable)
- [ ] 5.5 Compounding intervals enum + period-length resolver: daily, weekly, biweekly, half-month, four-week, monthly, bi-monthly, quarterly, semi-annual, annual, continuous, exact-days
- [ ] 5.6 Period-rate conversion: nominal-to-effective, effective-to-nominal, period-to-period (handles all interval combinations)
- [ ] 5.7 Date arithmetic: `addPeriods(date, count, interval)`, `endOfHalfMonth`, `nextBusinessDay`, leap-year handling
- [ ] 5.8 Property-based tests via `fast-check` for every helper (idempotence of round-trips, monotonicity of date addition, day-count symmetry rules)
- [ ] 5.9 Benchmark harness; assert each primitive completes 1M ops in < 1s on a reference machine
- [ ] 5.10 Public API documented with TSDoc; nothing in this package depends on Express, React, or the database

**Acceptance:** All property-based tests pass with 10,000 runs each; day-count outputs match TValue reference values for a 100-row test fixture; package has zero runtime dependencies on app code.

---

## Phase 6 — TVM solver: solve-for-unknown across PV/FV/PMT/i/n

Goal: reproducible "U" toggle on every TVM field.

- [ ] 6.1 Define the canonical TVM equation in continuous and discrete forms; document sign convention (cash inflows positive, outflows negative — match TValue)
- [ ] 6.2 Closed-form solvers: PV given (FV, PMT, i, n, type); FV given (PV, PMT, i, n, type); PMT given (PV, FV, i, n, type); n given (PV, FV, PMT, i, type)
- [ ] 6.3 Iterative solver for `i` (Newton-Raphson with Brent's-method fallback); convergence to 1e-10 within 50 iterations or controlled failure with diagnostic
- [ ] 6.4 Annuity-due (`type=1`) handled in every solver
- [ ] 6.5 Solve-for-balloon: special case where unknown is the residual at term end
- [ ] 6.6 Solve-for-down-payment given total purchase + financed terms
- [ ] 6.7 "Weighted unknowns" mode: mark multiple events as unknown sharing a relationship (e.g., 12 unknown payments equal in amount), solver returns the single value satisfying the system
- [ ] 6.8 Numerical guard rails: detect divergence, ill-conditioning, sign-error inputs; return structured `SolverResult` with `success | failure(reason)`
- [ ] 6.9 Regression fixtures: 30 hand-computed scenarios from TValue documentation reproduced exactly (cents-level)
- [ ] 6.10 Performance: any single solve completes in < 50ms

**Acceptance:** All 30 fixtures pass; weighted-unknown solver matches TValue behavior on 5 weighted-cases; failure modes return human-readable diagnostics.

---

## Phase 7 — Cash-flow event model + amortization engine

Goal: arbitrary irregular cash flows produce auditable schedules.

- [ ] 7.1 `CashFlowEvent` schema: `{date, kind: loan|payment|deposit|withdrawal|rate_change|skip_pattern|calendar_month_skip|stepped_amount|stepped_percentage|interest_only|fixed_principal|principal_applied_first|existing_note_valuation|balloon|prepayment|memo, amount?, rate?, count?, interval?, compounding_override?, memo?, series_options?: {skip_months?: number[], step_amount?: Money, step_percent?: Rate, requires_us_rule?: boolean}}`
- [ ] 7.2 Event-list normalizer: expand recurring events ("$1,000 monthly for 360 months") into atomic per-period entries; respect skips and step rules
- [ ] 7.3 Computation methods: `Normal` (compound interest), `USRule` (simple interest, no negative amortization), `RuleOf78`, `Canadian` (semi-annual compounding on monthly payments), `ExactDays`
- [ ] 7.4 Schedule generator iterates events chronologically maintaining: opening balance, interest accrued (per chosen day-count + compounding), payment applied, principal applied, closing balance, cumulative-interest, cumulative-principal
- [ ] 7.5 Mid-period rate changes: pro-rate accrued interest by exact days under the current rate before applying the new rate
- [ ] 7.6 Negative-amortization handling: explicit flag on the schedule; warning surfaced to UI
- [ ] 7.7 Prepaid-interest calculation for funding-date-not-on-period-boundary scenarios
- [ ] 7.8 Schedule level-of-detail option: full per-period, annual roll-up, fiscal-year roll-up, range filter, summary only
- [ ] 7.9 Memo passthrough on every event; preserved on roll-ups via concatenation
- [ ] 7.10 100-scenario regression fixture covering: balloon, IO period, step-up, step-down, skip, rate change, prepayment, US-Rule + Rule-of-78 + Canadian — each result matches TValue 6 exactly
- [ ] 7.11 **Cash-flow series-pattern catalog.** The engine must support every series pattern below; each must be implementable via the schema in 7.1 and the schedules they produce must reconcile against industry-standard examples (correctness benchmarks live in Phase 10):
  - **Normal** — payments / deposits / withdrawals applied first to outstanding interest, remainder to principal (default behavior)
  - **Stepped Amount** — series where amount increases or decreases by a fixed dollar amount at regular intervals (e.g., +$50 every 12 payments)
  - **Stepped Percentage** — series where amount increases or decreases by a fixed percentage at regular intervals (e.g., +3% every 12 payments)
  - **Interest Only** — payments cover all accrued interest each period; principal untouched until later events change it
  - **Fixed Principal Plus Interest** — payments equal a fixed principal amount plus all accrued interest (declining-payment loan)
  - **Skip Pattern** — pattern of N payments made followed by M payments skipped, repeating
  - **Calendar-Month Skip** — payments made in selected calendar months and skipped in the others (e.g., school district payroll: skip June + July)
  - **Existing-Note Valuation** — valuation mode for an existing fixed-payment-to-principal note at a discount/yield rate different from the note's stated rate
  - **Principal-Applied-First** — payments applied to principal first; unpaid interest accumulates separately and does not compound; **enforces U.S. Rule compute method** (validation error if Normal or Canadian is selected)
  - **Rate Change** — discrete event setting a new nominal rate effective from its date forward; not a series but lives in the same event grid
- [ ] 7.12 Series-options validators: calendar-month-skip months must be 1..12 with no duplicates; stepped-amount/stepped-percentage step values must be non-zero; principal-applied-first must be paired with US-Rule compute method; existing-note-valuation requires a separate yield rate input distinct from the master rate
- [ ] 7.13 Per-event compounding override: any event row can specify a compounding interval that differs from the master compounding period (e.g., master is Monthly but a specific series is Quarterly); the engine handles the period mismatch by accruing interest at the master rate over the actual elapsed days under the master compounding rule, then applying the series payment

**Acceptance:** All 100 regression fixtures pass cents-level; level-of-detail roll-ups reconcile (sum of detail = roll-up); negative-am scenarios flagged correctly; every series pattern from 7.11 has at least 3 fixture scenarios that match the published-example output exactly.

---

## Phase 8 — APR / Reg Z / Truth-in-Lending output

Goal: regulatory-grade APR computation and disclosure documents.

- [ ] 8.1 APR computation per Reg Z Appendix J (US Rule, actuarial method); handles odd days, irregular periods, prepaid finance charges
- [ ] 8.2 Finance-charge classification helpers: prepaid (deducted from amount financed), regular interest, financed (added to amount financed)
- [ ] 8.3 Amount Financed = Total of Payments − Finance Charge; cross-check identity asserted
- [ ] 8.4 Disclosure builder produces a structured `RegZDisclosure` object: APR %, finance charge $, amount financed $, total of payments $, payment schedule, late-payment terms, prepayment, security interest, assumability, required deposit
- [ ] 8.5 Tolerance checks: report APR within ±1/8% (regular) or ±1/4% (irregular) per Reg Z
- [ ] 8.6 PDF disclosure template matches FRB model form H-2 layout
- [ ] 8.7 Commercial financing disclosure mode (Appendix J pieces relevant to non-consumer debt)
- [ ] 8.8 Regression fixtures: 20 scenarios from Reg Z official commentary cross-checked

**Acceptance:** All 20 Reg Z fixtures match published examples; tolerance check correctly classifies edge cases.

---

## Phase 9 — Specialized TVM templates

Goal: pre-built scenarios that capture 80% of CPA TVM workflow.

- [ ] 9.1 Loan amortization (level payment) — wraps Phase 7 with a 4-input form (amount, rate, term, start date)
- [ ] 9.2 Loan with balloon — adds balloon-amount input; supports solve-for-balloon
- [ ] 9.3 Bond pricing & yield: par, coupon, frequency, settle date, maturity; output: clean price, dirty price, accrued interest, YTM
- [ ] 9.4 ASC 842 / IFRS 16 lease present-value capitalization: lease payments stream, discount rate, initial direct costs, prepayments → ROU asset + lease liability schedule
- [ ] 9.5 Troubled-debt-restructuring (TDR) PV-of-future-cash-flows: original effective rate, modified cash flows → impairment loss
- [ ] 9.6 Imputed interest / Section 7872: AFR-driven; pulls from the AFR table (Phase 22)
- [ ] 9.7 Below-market loan (Section 7872) — gift-loan, compensation-related, corporation-shareholder variants
- [ ] 9.8 Sinking fund: target FV, rate, periods → required deposit
- [ ] 9.9 Lease rate factor / residual / implicit rate solver
- [ ] 9.10 Note buy/sell yield: purchase price, remaining payments → buyer's yield
- [ ] 9.11 IRR / MIRR / NPV on arbitrary irregular cash flows
- [ ] 9.12 Each template has an input form, a result panel, a schedule view, and an "Open as cash-flow events" button that converts to the raw Phase 7 model for further editing
- [ ] 9.13 Each template has at least 5 regression fixtures

**Acceptance:** All 12 templates produce identical results to the same scenario built manually in the cash-flow-event UI.

---

## Phase 10 — TValue golden-file regression suite

Goal: a permanent CI-enforced parity bar.

- [ ] 10.1 Define a YAML schema for golden-file scenarios: inputs (events, conventions, options), expected outputs (every schedule row, summary totals, APR if applicable)
- [ ] 10.2 Author 50 scenarios spanning: every compounding interval, every day-count, every computation method, balloon, IO, step, skip, rate change, prepayment, fiscal-year totals, APR
- [ ] 10.3 Each scenario references its source TValue 6 file (committed to a private fixture repo) and the version of TValue that produced the expected output
- [ ] 10.4 Test runner loads YAML, runs the calc engine, asserts cents-level equality on every cell of the schedule and every summary number
- [ ] 10.5 CI gate: this suite must pass on every PR; failures block merge
- [ ] 10.6 Add a `just regression-update` workflow documenting how to legitimately update an expected value when TValue's published behavior changes (e.g., new TValue version)
- [ ] 10.7 Coverage report shows which conventions / methods / event types are exercised by at least 3 scenarios

**Acceptance:** Suite green on main; coverage report shows full matrix coverage; deliberately-broken-engine PR demonstrates suite catches the regression.

---

## Phase 11 — TVM workbench UI

Goal: the day-to-day workspace for a CPA building a calculation.

- [ ] 11.1 Top input panel: editable grid containing the columns required to support every feature in this plan — `Event | Date | Amount | Number | Period | End Date | Compounding | Rate | Memo`. (The visual treatment, column widths, headers, sort affordances, and styling are Vibe's own design — these are the *fields* the user can edit, not a layout mandate.) The Event column is a typed dropdown (Loan, Payment, Deposit, Withdrawal, Rate Change, plus a "Series →" submenu containing every type from Phase 7.11). End Date is read-only and auto-computed from Date + (Number × Period). The Compounding column overrides the master compounding for that single event row; left blank by default to inherit. The Rate column is editable on Rate Change events and on existing-note-valuation series; otherwise inherits the master rate. Inline "U" (unknown) toggle on every solvable cell — Amount, Rate, Number, End Date.
- [ ] 11.2 Click-to-add event row; drag to reorder (only same-date events); right-click context menu (insert above, duplicate, delete, convert to series)
- [ ] 11.3 "Series" editor as a dialog: amount + count + interval + step rule; renders into multiple normalized rows on save
- [ ] 11.4 Conventions panel (collapsed by default): computation method, compounding interval, day-count, year length, payment timing (begin/end)
- [ ] 11.5 Live recompute on every keystroke (debounced 200ms); failures surface inline (e.g., "rate cannot be negative")
- [ ] 11.6 Bottom result panel: summary totals (total interest, total payments, APR if computed, ending balance) and a tabbed schedule view (full / annual / fiscal year / range)
- [ ] 11.7 Schedule virtualization (TanStack Virtual) — handles 30-year monthly schedule (360 rows) with no jank
- [ ] 11.8 Save as named calculation; "Save and assign to engagement"; "Save as new version of existing"
- [ ] 11.9 Compare-versions side-by-side view (uses Phase 21 versioning)
- [ ] 11.10 What-if duplicate: clones inputs, opens new tab, links back to source for diff
- [ ] 11.11 Print preview button (opens Phase 13 export panel)
- [ ] 11.12 Keyboard shortcut help dialog (cmd-/)
- [ ] 11.13 Empty state with template picker (drops user into one of the Phase 9 templates)
- [ ] 11.14 Accessibility: full keyboard navigation, ARIA roles on the editable grid, screen-reader-friendly schedule output
- [ ] 11.15 **Master controls bar** at the top of the workbench: Label (free-text calculation name), Compounding Period dropdown (the master), Nominal Annual Rate input, "View Amortization Schedule" action. (Visual layout is Vibe's own design.)
- [ ] 11.16 **Loan Details dialog** (modal triggered from a workbench action): metadata fields used in PDF headers and not part of the math — borrower name, lender name, loan type, prepared-by user, prepared-on date, original-loan-date, additional notes, custom field 1/2/3; values flow through to the Phase 13 export templates
- [ ] 11.17 **Workbench actions (all keyboard-accessible).** The set of operations the user must be able to perform; the *placement, grouping, iconography, and visual treatment* are Vibe's own design:
  - Insert Line / Delete Line (above selected row)
  - Set Unknown (toggles "U" on selected cell)
  - Restore Unknowns (clears all "U" markers across the grid and reverts to last computed values; requires confirmation)
  - Memo (opens the memo editor for the selected row; multi-line)
  - Loan Details (opens the dialog from 11.16)
  - Insert Series (opens a picker offering every type from Phase 7.11; configures and inserts a series row)
  - Expand Series (takes a series row like "24 Monthly Payments of $609" and expands it into 24 individual rows the user can edit one-by-one)
  - Compress to Series (the inverse: select N consecutive identical rows and collapse them back into a single series row; warns if amounts/dates are not exactly compressible)
  - Sort (sorts grid rows by Date ascending; deterministic tie-break by event type — Loan first, then Rate Change, then Payment/Deposit/Withdrawal, then Skip)
  - Show Running Balance (inline-displays the running balance after each event row as a virtual column; toggle on/off)
  - Show Cumulative Totals (inline-displays cumulative payments / cumulative interest after each row as virtual columns; toggle on/off)
  - Rounding Rule (opens the rounding-rule dialog: cents-level / dollar-level / no-rounding for the displayed schedule, plus banker's-vs-half-up selector matching Phase 5.2)
  - Recalculate (force-recompute; no-op when live recompute is enabled, but available for very large schedules where live recompute is throttled)
- [ ] 11.18 **Period-dropdown smart filtering**: the per-row Period dropdown disables intervals that are mathematically incompatible with the master Compounding Period — e.g., a Monthly master compounding cannot host a Weekly, Biweekly, or 4-Week series row because they don't tile cleanly into the master period. Disabled entries show a tooltip explaining why they're unavailable and what the user could change to enable them
- [ ] 11.19 **Multi-calculation tabs**: users can have multiple calculations open simultaneously in browser tabs within the workbench shell; each maintains its own dirty state and undo stack; cmd-` cycles between open calcs
- [ ] 11.20 **Undo / redo** stack per open calculation: 100 steps deep; cmd-Z / cmd-shift-Z; survives page refresh by persisting to IndexedDB
- [ ] 11.21 **Date-arithmetic shortcuts in the Date column**: typing `010125` becomes `01/01/2025`; typing `+1m` adjusts the selected date by one month; arrow-up/down on a focused date cell increments by one day; shift-arrow by one month; ctrl-arrow by one year
- [ ] 11.22 **Amount-input shortcuts** (Phase 4.4 already covers the input itself; this item wires it into the grid context): `K` / `M` / `B` suffix multipliers; typing `U` enters Unknown; typing a leading `-` flips sign; paste-from-clipboard handles `$1,234.56` and `(1,234.56)` (parens = negative)

**Acceptance:** A power user can build a 30-year mortgage with one balloon and one rate change in under 60 seconds, keyboard only; the resulting schedule matches Phase 7 fixture cents-level. Every series pattern from Phase 7.11 is reachable via the Insert-Series action and produces correct schedules. Expand → Compress on the same series round-trips losslessly. Restore Unknowns correctly reverts a partially-edited grid to its last fully-computed state. The Period dropdown correctly disables incompatible intervals based on the master Compounding Period.

---

## Phase 12 — Schedule rendering and visualization

Goal: clean, professional on-screen schedules and charts.

- [ ] 12.1 Schedule grid component: sticky header, sticky first column (date), per-column alignment (right for $, decimals aligned)
- [ ] 12.2 Year-end / fiscal-year-end rows visually distinct (background tint + bold)
- [ ] 12.3 Negative-amortization rows highlighted with a warning icon and tooltip
- [ ] 12.4 Memo column truncates with hover-expand
- [ ] 12.5 Inline "annotate" feature: user can add a per-row note saved to `calculation_versions.row_annotations`
- [ ] 12.6 Charts (Recharts): principal-vs-interest stacked area over time; remaining-balance curve; cumulative-interest curve; switchable tabs
- [ ] 12.7 "Show me the math" tooltip on any cell: displays the underlying formula and inputs that produced it (huge differentiator vs. TValue)
- [ ] 12.8 Export the on-screen schedule to clipboard (TSV) for paste into Excel
- [ ] 12.9 Print stylesheet (`@media print`) that produces a clean schedule when the user does cmd-P

**Acceptance:** "Show me the math" displays correct, human-readable derivation for every schedule cell type; charts render correctly across light/dark mode.

---

## Phase 13 — Reporting / export pipeline (PDF, XLSX, CSV, DOCX)

Goal: client-ready deliverables with firm branding.

- [ ] 13.1 PDF engine: Puppeteer in a long-lived headless-chrome process pool (3 workers), templates rendered as React components → HTML → PDF
- [ ] 13.2 PDF templates: Amortization Schedule, Reg Z Disclosure, Lease Capitalization, Bond Yield, IRR/NPV summary, Tax Calculator memo (Phase 18+)
- [ ] 13.3 Firm-branding settings (uploaded in Phase 25 setup wizard): logo (max 1MB), firm name, address, phone, default disclaimer footer; rendered into every PDF header/footer
- [ ] 13.4 XLSX export via ExcelJS: native formulas where possible (so the recipient can re-run the schedule themselves), styled headers, frozen first row, currency formatting
- [ ] 13.5 CSV export: RFC-4180 compliant, UTF-8 BOM optional toggle for Excel-on-Windows compatibility
- [ ] 13.6 DOCX export via `docx` library: useful for memo-style outputs (tax-planning narratives, Phase 18+) with bookmarks the user can edit
- [ ] 13.7 All exports go through a BullMQ job queue; UI shows progress; output stored at `/data/exports/{user_id}/{calc_id}/{timestamp}.{ext}` with 30-day retention
- [ ] 13.8 Bulk export: select N calculations → produce a zip
- [ ] 13.9 Email delivery (Phase 22 wires the SMTP config); button "Email this PDF to client/colleague"
- [ ] 13.10 Watermark option for draft outputs ("DRAFT — Not for Distribution")

**Acceptance:** PDF schedule output passes a visual diff against a reference baseline; XLSX schedule recomputes correctly when a user changes the rate cell; DOCX memo is editable in Word with intact bookmarks.

---

## Phase 14 — Tax-year rate tables and locking mechanism

Goal: every tax calc result is reproducible against the rate table that was current when the calc was created.

- [ ] 14.1 `tax_year_tables` table: `(tax_year, table_kind, payload_json, effective_from, effective_to, source_url, source_version)`
- [ ] 14.2 Table kinds for MVP: federal_tax_brackets (single, mfj, mfs, hoh, qw), standard_deduction, fica_wage_base, medicare_thresholds, niit_thresholds, qbi_thresholds, section_179_limits, bonus_depreciation_pct, macrs_tables, rmd_uniform_lifetime, rmd_joint_life, rmd_single_life, retirement_contribution_limits, social_security_wage_base, hsa_contribution_limits, afr_short_mid_long, ss_optimal_age_table, alternative_minimum_tax_exemption
- [ ] 14.3 Seed data for tax years 2023, 2024, 2025, 2026 (where published) sourced from IRS Pub 17, Pub 946, Rev. Proc. annual updates
- [ ] 14.4 Each tax calculation persists `tax_year` + the `tax_year_tables` row IDs it consumed → recomputation always uses the same tables
- [ ] 14.5 Annual update workflow: ship a new minor release containing the next year's tables; existing calcs untouched; new calcs default to current tax year
- [ ] 14.6 Admin UI: browse rate tables by year/kind, view source URL, see which calcs are using which versions
- [ ] 14.7 OBBBA / SECURE 2.0 / one-off legislative-change handling: a `tax_year_overrides` table for mid-year retroactive changes (e.g., 100% bonus depreciation reinstatement for property placed in service on/after 1/20/2025)
- [ ] 14.8 Defensive runtime check: if a calc references a table version that was later marked `superseded_at`, surface a banner ("Tax tables were corrected after this calc was saved — review and recompute")

**Acceptance:** Recomputing a 2024-tax-year calculation in the year 2026 produces the identical 2024 result; switching tax years updates input options visibly (e.g., 2025 SUV cap differs from 2026).

---

## Phase 15 — Tax engine framework + calculator scaffolding

Goal: a uniform internal contract every tax calculator implements, so adding new ones is mechanical.

- [ ] 15.1 `TaxCalculator<I, O>` interface: `metadata: {kind, name, taxYears, formReferences[]}`, `validateInputs(I): Result`, `compute(I, RateTables): O`, `narrate(I, O): string` (plain-English memo)
- [ ] 15.2 Each calculator lives in `packages/tax-engine/calculators/{kind}.ts` with tests in `{kind}.test.ts` and fixtures in `{kind}.fixtures.yml`
- [ ] 15.3 Auto-generated REST endpoints (Phase 24) by introspecting the registered calculators
- [ ] 15.4 Auto-generated frontend forms via JSON schema + custom widget overrides
- [ ] 15.5 Standard output panel layout: inputs summary card, key result card (big number + supporting figures), supporting schedule (when applicable), narrative memo (collapsible), citations (which IRS forms / pubs / IRC sections back this calc)
- [ ] 15.6 Per-calculator help drawer: explanation, IRS source links, common pitfalls, examples
- [ ] 15.7 Unit-test scaffold + fixture-driven test runner shared across all calculators

**Acceptance:** A trivial "double the input" toy calculator can be added in < 50 LOC and shows up automatically in the UI sidebar, REST API, and help system.

---

## Phase 16 — Tier-1 tax calculators, Part A: depreciation suite

Goal: the most-used CPA-advisory calculators in this category.

- [ ] 16.1 **MACRS depreciation schedule** — IRS Pub 946 tables; property classes 3/5/7/10/15/20/25/27.5/39-year; half-year, mid-quarter, mid-month conventions; ADS option; year-by-year basis tracking; switch-to-straight-line trigger handled automatically; Section 168(k) eligible-property flag
- [ ] 16.2 **Section 179 expensing** — current-year limit and phase-out threshold (sourced from rate tables), SUV cap, business-income limitation with carryforward, married-filing-separately allocation rule
- [ ] 16.3 **Bonus depreciation** — 168(k) percentage by placed-in-service date (handles the OBBBA reinstatement: 100% for 1/20/2025+, 40% for earlier 2025, 60% for 2024, etc.); election-out option per property class
- [ ] 16.4 **Combined Section 179 + bonus + MACRS waterfall** — single input form, one consolidated schedule that applies them in IRS-required order: Section 179 → bonus → MACRS on remaining basis
- [ ] 16.5 **Cost-segregation impact estimator** — user supplies a building's basis and a study allocation across 5/7/15/39-year buckets; output shows year-1 deduction lift, NPV at supplied discount rate, and full schedule
- [ ] 16.6 Per-asset library scoped to engagement: add multiple assets, see firm-wide schedule, export consolidated Form 4562 worksheet
- [ ] 16.7 Like-kind exchange basis carryover hook (used by Phase 19's 1031 calc)

**Acceptance:** Every calc reproduces the worked examples in IRS Pub 946 Appendix A within $1; the OBBBA placed-in-service cutoff is verified by a dedicated regression test.

---

## Phase 17 — Tier-1 tax calculators, Part B: retirement + investment

Goal: RMD, Roth conversion, and capital-gains analysis.

- [ ] 17.1 **RMD calculator** — Uniform Lifetime, Joint Life (spouse > 10 years younger), Single Life (inherited); SECURE 2.0 age-73 (2023–2032) and age-75 (2033+) logic; aggregation across IRAs (allowed) and 401(k)s (separate); inherited-IRA 10-year rule with conditional-life-expectancy years for eligible designated beneficiaries
- [ ] 17.2 **Roth conversion analyzer** — single year and multi-year ladder; tax cost computed against current brackets; compare future tax-free withdrawals at supplied retirement age; IRMAA threshold flag; estate-planning toggle; break-even age display
- [ ] 17.3 **Capital gains / loss harvesting** — short-vs-long, NIIT 3.8% surtax, Section 1202 QSBS exclusion (50/75/100% by acquisition date), wash-sale flag, lot-level basis tracking; carry-over loss tracker
- [ ] 17.4 **QBI (Section 199A) deduction** — non-SSTB and SSTB phase-in thresholds (sourced from rate tables), W-2 / UBIA limits, aggregation election, REIT/PTP add-on, overall taxable-income limit
- [ ] 17.5 Per-calc PDF memo template with IRS form references printed at the bottom

**Acceptance:** Each calc matches a published worked example (Pub 590-B for RMD, Pub 535 / Form 8995 instructions for QBI, Pub 550 for capital gains) within $1.

---

## Phase 18 — Tier-1 tax calculators, Part C: SE tax, safe harbor, state estimator

Goal: the routine "what should I pay this quarter" calculators.

- [ ] 18.1 **Federal estimated-tax safe-harbor calculator** — 90% / 100% / 110% rules (the 110% triggers above the AGI threshold); quarterly due-date calendar (4/15, 6/15, 9/15, 1/15); prior-year tax import field; underpayment-penalty rough estimator; printable client memo "Pay $X by each date to satisfy safe harbor"
- [ ] 18.2 **Self-employment tax** — Schedule SE logic; 92.35% SE earnings; 12.4% OASDI to wage base + 2.9% Medicare unlimited + 0.9% Additional Medicare above threshold; half-SE deduction
- [ ] 18.3 **State income-tax quick-estimator** — MVP states: MO (primary), CA, NY, FL (N/A — no income tax), TX (N/A), IL, PA, OH, GA, NC, AZ; flat-rate states use the rate, bracketed states pull from rate tables; pluggable so additional states can be added later; display as "approximate; not a substitute for state form prep"
- [ ] 18.4 Annualization helpers — given YTD wages or YTD SE earnings + as-of date, project full-year amounts for safe-harbor / SE-tax planning; supports weekly, biweekly, semi-monthly, monthly cadences

**Acceptance:** Safe-harbor calc reproduces 5 hand-worked CPA scenarios; SE calc matches Schedule SE worksheet; state quick-estimator matches each state's published bracket schedule for 2025 + 2026 within $1.

---

## Phase 19 — Tier-2 tax calculators

Goal: the rest of the high-value tax-advisory tooling.

- [ ] 19.1 **AMT estimator** — AMTI build-up (start from regular taxable income, add preferences/adjustments), AMT exemption + phase-out, TMT vs. regular tax, ISO-exercise scenario mode (bargain element add-back)
- [ ] 19.2 **Like-kind exchange (Section 1031)** — boot calculation, deferred gain, new-property substitute basis, depreciation-recapture flag for partial-boot scenarios; passes basis schedule to MACRS calc (Phase 16 hook)
- [ ] 19.3 **Installment sale (Section 453)** — gross-profit ratio, gain recognized per period, OID / imputed-interest handling, recapture in year of sale rule
- [ ] 19.4 **Section 121 home-sale exclusion** — $250k / $500k limits, ownership and use tests, nonqualified-use periods, partial exclusion for unforeseen circumstances (work, health, unforeseen events)
- [ ] 19.5 **IRS interest & failure-to-file / failure-to-pay penalty calculator** — head-on competitor to TimeValue's TaxInterest; rates per IRC §6621 (sourced from rate tables, updated quarterly), 5%/0.5% penalty rules with stacking limits, abatement scenario toggle
- [ ] 19.6 **HSA contribution & projection** — self-only vs. family limit, age-55 catch-up, last-month rule + testing-period implications, triple-tax-advantage accumulation projection
- [ ] 19.7 **Qualified plan contribution-limit calculator** — 401(k)/403(b)/457(b) employee + employer combined 415(c), SEP IRA (lesser of 25% or annual limit), SIMPLE IRA, Solo 401(k), defined benefit max contribution at supplied age + W-2 wage history
- [ ] 19.8 **Social Security claiming-age optimizer** — file at 62 vs. FRA vs. 70, spousal benefit, survivor benefit; break-even age; PIA estimate from supplied 35-year earnings or AIME
- [ ] 19.9 Each calc has its own narrative memo template and IRS form references in the PDF footer

**Acceptance:** Each calc has at least 3 fixture-based regression tests citing a Pub or form instruction example; IRS interest calc matches TimeValue TaxInterest output on 5 published-rev-proc scenarios within $0.01.

---

## Phase 20 — Client / engagement workspace + tagging + search

Goal: every calc lives in a structured workspace, not an OS folder.

- [ ] 20.1 Clients index page: searchable, filterable by tag/archived status, sortable; "New client" wizard
- [ ] 20.2 Client detail page: contact info, tags, list of engagements grouped by tax year, list of standalone calculations, recent activity feed
- [ ] 20.3 Engagement detail page: assigned preparer/reviewer, status workflow (draft → in_review → approved → closed), list of calcs grouped by kind, comments thread (Phase 21), attachments (PDF outputs), exported deliverables history
- [ ] 20.4 Tagging UI: free-form tag input with autocomplete; bulk-tag selected items; saved-tag-filter views
- [ ] 20.5 Global search (cmd-K): hits clients, engagements, calculations, calc inputs (e.g., search "$500,000" → finds all calcs that have that loan amount); ranks by recency + role-relevance
- [ ] 20.6 "My queue" dashboard: items assigned to me grouped by status; SLA indicator for items in_review > 3 days
- [ ] 20.7 Bulk actions: archive, reassign, change tax year, export
- [ ] 20.8 Client merge / split tools (admin only)

**Acceptance:** A staff CPA can find any calc they touched in the last 90 days within 3 clicks; bulk-archive of 100 calcs completes in < 2 seconds.

---

## Phase 21 — Versioning, audit trail, reviewer/preparer workflow

Goal: every change is provably attributable.

- [ ] 21.1 Every save creates a `calculation_versions` row with full inputs+outputs snapshot, author, timestamp; current pointer on `calculations.current_version_id`
- [ ] 21.2 Version history viewer: side-by-side diff (left: previous, right: current) with cell-level highlights; rollback button creates a new version (never destructive)
- [ ] 21.3 `audit_events` table captures: create/update/delete on every domain entity, login events from Phase 2.8, role changes, export downloads, email sends, settings changes; never editable, only insertable; tamper-evident hash chain (each row contains hash of previous row)
- [ ] 21.4 Audit log viewer (admin only): filter by user / entity / time range / event kind; CSV export for external compliance review
- [ ] 21.5 Preparer/Reviewer workflow: preparer marks calc "Ready for Review"; reviewer sees in queue; reviewer approves (locks current version) or sends back with comments; locked versions cannot be modified — modification creates a new draft version while preserving the locked one
- [ ] 21.6 Per-calc comments thread (mentions @user, attachments, edit-history); notifications via in-app + email
- [ ] 21.7 "Approved" calcs can be exported as a "signed PDF" containing the approver's name, timestamp, and a content hash printed in the footer

**Acceptance:** Tampering with any audit_events row is detected by the hash-chain validator; full review cycle (preparer → reviewer → approve) completes successfully; rollback preserves the rolled-back version in history.

---

## Phase 22 — Saved calc scheduling, AFR auto-update, email delivery

Goal: the appliance does work for you, not just on demand.

- [ ] 22.1 SMTP outbound configuration (admin UI): host, port, TLS mode, auth, from-address, reply-to; "Send test email" button; falls back to Postmark / SES SMTP relay if no firm SMTP is available
- [ ] 22.2 BullMQ job queues: `exports`, `email`, `scheduled-recalc`, `afr-update`, `backup` — separate queues with isolated concurrency limits
- [ ] 22.3 AFR auto-update job: monthly cron polls IRS AFR page (configurable URL), parses short/mid/long rates, writes to `tax_year_tables` with `effective_from = first of next month`; admin notification on success or parse failure; manual override UI for offline appliances
- [ ] 22.4 Scheduled-recalculation: per-calc setting "recompute every quarter on day-of-quarter X, email PDF to {user list}" — e.g., quarterly safe-harbor refresh for every active client
- [ ] 22.5 Recompute job: rebuilds calc with current rate tables (or locked tables, configurable), produces new version, attaches PDF, sends email, logs to audit
- [ ] 22.6 Email templates (MJML → HTML): export-ready, scheduled-recompute-summary, review-requested, comment-mention, password-reset, magic-link, account-invitation
- [ ] 22.7 Per-user email preferences: digest mode (daily summary) vs. immediate
- [ ] 22.8 Outbound-email log table for support / debugging

**Acceptance:** A scheduled quarterly recalc fires on time, produces a new version, emails the PDF to the assigned preparer with the firm's branded template, and logs an audit event.

---

## Phase 23 — AI-assisted loan-agreement extraction

Goal: User pastes loan-agreement language (or uploads the agreement PDF); the system extracts a structured cash-flow event list, opens it in the TVM workbench for review, and reconciles its result against any payment / APR figure mentioned in the document.

Architecture follows the existing Vibe LLM pattern: a capability-driven `LLMProvider` interface with Anthropic API as the primary cloud (Tier 2) provider and an optional local Tier 1 provider (Qwen3-8B via vibe-llm-server) for offline / privacy-first deployments.

- [ ] 23.1 `LLMProvider` interface in `packages/llm` with methods `complete()`, `completeStructured(schema)`, `estimateCost(messages)`, `capabilities()` — returns `{tools, structured_output, max_context, redaction_friendly}`
- [ ] 23.2 Anthropic provider implementation: uses official SDK, JSON-mode via tool-use, supports `claude-sonnet-*` and `claude-haiku-*` model strings; per-firm API key stored encrypted at rest (AES-256-GCM, key from `VIBE_KMS_KEY` env)
- [ ] 23.3 Local provider implementation: OpenAI-wire-format pointed at vibe-llm-server endpoint configurable in admin settings; capability flags reflect Qwen3-8B's structured-output reliability
- [ ] 23.4 Admin settings UI under Settings → AI: provider selection (None / Anthropic / Local / Both), API key entry with paste-once-then-masked behavior, model selection, daily / monthly cost ceilings per user and per firm, "Send test request" button
- [ ] 23.5 Privacy/redaction pipeline: configurable per-extraction toggle that scrubs SSNs, EINs, full names, account numbers from the prompt before sending to a cloud provider; the redacted view is logged for audit; toggle defaults to ON for cloud, OFF for local
- [ ] 23.6 Document input UI at `/extract`: paste textarea (max 50,000 chars), drag-drop area for PDF / DOCX up to 10MB, "Extract events" button; live cost estimate updates as the user types
- [ ] 23.7 Document parsing: PDFs go through `pdf-parse` in a worker process; DOCX via `mammoth`; extracted plain text is shown to the user in an editable preview before extraction runs (so they can trim to just the relevant section)
- [ ] 23.8 Extraction prompt template (versioned in DB, editable by admin under Settings → AI → Prompts): instructs the model to extract loan amount, interest rate, payment amount, payment frequency, term, start/funding date, balloon, prepayment terms, late fees, day-count convention, computation method, computation start, irregular payment schedules, rate-change provisions; output a JSON object conforming to a schema derived from the Phase 7 `CashFlowEvent[]` plus a per-field `confidence: 0..1` and a `source_quote` containing the exact agreement text that justified the value
- [ ] 23.9 Schema validation on the model's response (Zod): malformed responses trigger one auto-retry with a corrective system message; second failure surfaces a structured error to the user with the raw response collapsed below
- [ ] 23.10 Source-highlighted review UI: left pane shows the document text with extracted spans highlighted; right pane shows extracted fields grouped (Loan Terms / Payment Schedule / Special Provisions); clicking a field scrolls/highlights its source span; low-confidence (< 0.8) fields show a warning badge and require explicit confirmation
- [ ] 23.11 "Apply to workbench" action: extracted events are normalized through the Phase 7 cash-flow event model; opens a new draft calculation in the Phase 11 TVM workbench with `extracted_from_document_id` set
- [ ] 23.12 **Reconciliation check (key correctness gate):** if the source document mentions an APR, monthly payment, total of payments, or final balloon amount, the system independently recomputes the schedule from the extracted events and asserts agreement within published Reg Z tolerances (Phase 8); discrepancies are surfaced as a banner ("Document states monthly payment of $1,847.21; computed payment is $1,852.04 — review extraction") and prevent silent errors
- [ ] 23.13 Document storage: original document + extracted text + model response + extracted-event JSON archived under `/data/extractions/{client_id}/{extraction_id}/`; retention follows engagement retention rules; user can re-run extraction with a different prompt version against the same source
- [ ] 23.14 Per-extraction cost ledger row: provider, model, input tokens, output tokens, dollar cost (computed from current rate sheet), user, calculation_id, timestamp; visible to admin under Reports → AI Usage; soft warning at 80% of cap, hard block at 100%
- [ ] 23.15 Audit-event entries (Phase 21) for every AI call: prompt hash, response hash, redaction-on/off flag, provider, model, cost, success/failure; full prompt and response retained in audit storage but excluded from default UI views (admin can request)
- [ ] 23.16 Offline-mode behavior: when `VIBE_OFFLINE=true` is set on the appliance, only the local provider is selectable; cloud providers are listed with a "disabled — appliance is in offline mode" tooltip
- [ ] 23.17 Prompt versioning: prompts stored as `ai_prompts (id, kind, version, body, system_message, created_by, active)`; admin can A/B test by setting two prompts active and tagging extractions with the prompt version used
- [ ] 23.18 Regression fixture suite: 15 anonymized real-world loan-agreement excerpts (collected with explicit consent) → expected extracted-event JSON; CI runs against a recorded mock of the LLM response so prompt changes are detected as test failures; nightly job runs against the live Anthropic API on a small subset and alerts on drift
- [ ] 23.19 Documentation: `EXTRACTION.md` covers prompt design rationale, redaction guarantees, what the system does **not** do (it does not provide legal advice, does not warrant interpretation of contract language), and explicit operator-facing language to share with end-clients about AI use

**Acceptance:** Given a 200-word loan-clause excerpt containing an explicit loan amount, rate, term, and monthly payment, the system extracts a CashFlowEvent[] that — when run through the Phase 7 engine — produces a payment within $1 of the document's stated payment; the source-highlight UI correctly anchors each extracted field to the supporting agreement text; cost ledger captures the call; redaction toggle behaves as configured.

---

## Phase 24 — REST API and webhooks

Goal: the firm's other systems can drive Vibe Calculators.

- [ ] 24.1 OpenAPI 3.1 schema generated from Zod source-of-truth; `/api/docs` serves Swagger UI when not in production-locked mode
- [ ] 24.2 API tokens: per-user, scoped (read / write / admin), revocable, expiring; SHA-256 stored; never displayed after creation
- [ ] 24.3 Endpoints: `/api/v1/clients`, `/api/v1/engagements`, `/api/v1/calculations`, `/api/v1/calculations/{kind}/compute` (synchronous compute without persisting), `/api/v1/exports`, `/api/v1/users` (admin), `/api/v1/audit-events` (admin)
- [ ] 24.4 Compute endpoints accept the same input shape the UI uses → contract tests verify UI and API agree byte-for-byte
- [ ] 24.5 Webhook subscriptions (admin UI): event types (calc.created, calc.approved, export.completed, audit.high_risk), HMAC-signed payloads, retry with exponential backoff (5/15/60/300/1800 sec), dead-letter table after 5 failures
- [ ] 24.6 Rate limiting: 60 req/min per token by default, configurable per-token; 429 with Retry-After header
- [ ] 24.7 API audit log integrated with Phase 21 audit_events

**Acceptance:** End-to-end test: external script creates a client, opens an engagement, posts a MACRS calc, downloads the PDF — purely via API.

---

## Phase 25 — Docker appliance packaging, setup wizard, backup/restore

Goal: a CPA firm with no DevOps experience can stand up the appliance in 15 minutes.

- [ ] 25.1 GHCR image publishing for `vibecalc-api`, `vibecalc-web`, `vibecalc-worker` with OCI labels (source, version, build-date, git-sha) — same convention as other Vibe products
- [ ] 25.2 Single `docker-compose.yml` (and optional `compose.override.yml` for production tweaks) that pulls pinned image tags
- [ ] 25.3 First-run setup wizard accessible at `/setup` when DB has no admin: firm info (name, address, EIN), brand assets (logo, primary color), first admin user, SMTP config (skippable), deploy mode (domain / LAN / Tailscale), tax-year defaults
- [ ] 25.4 Wizard writes a `firm_settings` row + creates first admin + uploads logo to `/data/branding`
- [ ] 25.5 `vibecalc-installer` CLI shim (Node-based, downloadable binary) with subcommands: `install`, `upgrade`, `uninstall`, `status`, `mode`, `doctor`, `backup`, `restore` — consistent with Vibe Appliance pattern
- [ ] 25.6 `doctor` checks: Docker version, available disk, Postgres reachable, Redis reachable, Caddy ports bound, SMTP test, AFR-update job last-run, backup last-run
- [ ] 25.7 Backup: nightly `pg_dump` (custom format) + tar of `/data` (uploads, exports, branding), encrypted with operator-supplied passphrase, retained 7 daily / 4 weekly / 12 monthly
- [ ] 25.8 Restore wizard: select backup → confirm destructive replace → apply → smoke-test → audit event
- [ ] 25.9 Health endpoint matures: `/api/health` (basic), `/api/health/deep` (DB write+read, Redis ping, queue depth, worker last-heartbeat); used by Caddy active health checks
- [ ] 25.10 Offline mode: respect `VIBE_OFFLINE=true` to disable AFR auto-update, telemetry, image-update checks; surface "Offline mode" badge in UI
- [ ] 25.11 Resource sizing guidance documented in `DEPLOY.md`: minimum (NucBox M6-class: 4 vCPU, 16GB RAM, 256GB SSD), recommended, large
- [ ] 25.12 Update procedure documented: `vibecalc-installer upgrade` runs migrations, never destructive, with auto-snapshot pre-upgrade

**Acceptance:** A clean Ubuntu 24.04 LTS box can install Docker, run the installer, complete setup, log in, build a calc, export a PDF — all in under 30 minutes from a printed quickstart sheet.

---

## Cross-cutting build conventions

- **Math:** Never `Number` for money or rates. `Money` and `Rate` types only. Lint rule rejects `parseFloat`/`parseInt` in `packages/calc-engine` and `packages/tax-engine`.
- **Time:** All timestamps stored UTC, displayed in firm timezone (firm-level setting). `date-fns-tz` for conversions. Never `Date.parse(string)` — always explicit ISO with timezone.
- **Validation:** Zod schemas at every boundary (HTTP, DB read, queue payload). Inferred TypeScript types only — no separate hand-written interfaces.
- **Errors:** All errors classed via a `VibeError` discriminated union. HTTP layer maps to RFC 7807 problem-details JSON. Never expose stack traces in production responses.
- **Tests:** Minimum 80% line coverage on `packages/calc-engine` and `packages/tax-engine`. Property-based tests for math primitives. Fixture-based regression tests for every calculator.
- **Logging:** Pino structured JSON; per-request correlation ID propagated to workers; PII redaction (SSN, EIN, full name in body) by default.
- **Migrations:** Drizzle Kit; every migration reversible; migration tests run on a copy of seed DB in CI.
- **Documentation as a deliverable:** Every phase produces or updates `DOCS/{phase}.md`; the user-facing operator manual is built from these in Phase 25.

## Suggested execution order

The phases above are also the recommended execution order. Do not parallelize ahead of dependencies:

- Phases 1–4 lay the platform; nothing else works without them.
- Phases 5–10 build the TVM core; Phase 10's regression suite is the gate that proves the engine works.
- Phases 11–13 are the TVM-product MVP — at this point the appliance has shippable user value as a TValue alternative even before any tax content.
- Phases 14–19 layer the tax suite; they could in principle run in parallel after Phase 15, but doing them sequentially keeps the regression-test discipline tight.
- Phases 20–22 are the workflow features that turn the product from "calculator" into "firm tool."
- Phase 23 is the AI extraction differentiator; valuable for marketing and power-users, but the appliance is fully functional without it. Defer until phases 1–22 are stable.
- Phase 24 enables integration scenarios; defer until at least one customer asks for it.
- Phase 25 is required for any external deploy.

A reasonable staffing model with Claude Code as the primary developer: phases 1–13 in months 1–4, phases 14–19 in months 5–8, phases 20–25 in months 9–11, with month 12 reserved for hardening, beta feedback, and the public release.
