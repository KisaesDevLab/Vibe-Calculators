# Vibe Calculators

Self-hosted Docker appliance providing:

- **TValue-grade time-value-of-money calculations** (loan amortization, lease ASC 842, bond pricing, sinking funds, etc.) via the `@vibe-calc/calc-engine` package.
- **A 14-calculator tax-advisory suite** spanning depreciation (MACRS, §179, bonus, cost-seg), retirement (RMD, Roth conversion, capital gains, QBI), planning (SE tax, safe harbor, state estimator, annualization), and Tier-2 (AMT, §1031, §453, §121, IRS interest, HSA, qualified-plan limits, Social Security optimizer) — all driven by IRS-published rate tables.
- **An AI-assisted loan-agreement extraction pipeline** powered by the Anthropic API.

The complete build plan lives in [`vibe-calculators-Build.md`](./vibe-calculators-Build.md).
Per-phase progress lives in [`PHASE_LOG.md`](./PHASE_LOG.md).

## Quickstart

```sh
# 1. Copy environment example and fill in values
cp .env.example .env

# 2. Boot the appliance (first run takes a few minutes to build images)
just up

# 3. Apply migrations
just migrate

# 4. Sign in with the default admin (printed in the api log on first boot)
#    email:    admin@local.test
#    password: vibe-admin-changeme
#    You will be required to set a new password on first login.
docker compose logs --no-log-prefix api | grep -A 6 'default admin seeded'

# 5. Visit http://localhost/login
```

## Architecture

A pnpm-workspaces monorepo. Top-level layout:

```
apps/
  api/          Express + Drizzle backend
  web/          React 18 + Vite + Tailwind + shadcn/ui frontend
packages/
  calc-engine/  TVM math (decimal.js, no floats for money)
  tax-engine/   14 tax calculators with shared TaxCalculator<I,O> framework
  shared-types/ Zod schemas + permission matrix
  db/           Drizzle ORM schema + migrations + seed
  pdf/          PDF / XLSX / CSV / DOCX export pipeline
  email/        SmtpProvider / PostmarkProvider / EmailItProvider
  llm/          LlmProvider interface + Anthropic impl + loan-extraction schema
```

Infrastructure: Postgres 16, Redis 7, Caddy (sole ingress, three deploy modes — `lan` / `domain` / `tailscale`).

## Public API

A REST API is exposed under `/api/v1/`. Authenticate via session cookie (web UI) or `Authorization: Bearer vibe_<token>` for headless integrations.

The OpenAPI 3.0.3 spec is served at `/api/v1/openapi.json` (no auth required).

API keys are issued by an admin via `POST /api/v1/admin/api-keys`; the plaintext is shown once and not retrievable afterward.

Webhooks (signed via HMAC-SHA256 in `X-Vibe-Signature: t=<unix>,v1=<hex>`) can be subscribed via `POST /api/v1/webhooks`.

## Operator commands

`just <command>` works on macOS, Linux, and Windows. The most common:

```
just up          # build + start (background)
just down        # stop (keeps data)
just nuke        # stop AND drop volumes
just logs        # tail every service
just status      # docker compose ps
just psql        # psql shell against the running Postgres
just migrate     # apply Drizzle migrations
just seed        # dev fixtures
just backup      # pg_dump + uploads → ./backups/<timestamp>/
just restore <dir>   # restore from a backup (verifies checksums)
just test        # run every workspace's tests
```

## Email / AI / AFR configuration

- **Email** — set `VIBE_EMAIL_PROVIDER` to `smtp`, `postmark`, or `emailit` and fill the matching block in `.env`. The factory rejects misconfigured environments at boot.
- **AI extraction** — set `ANTHROPIC_API_KEY` to enable. Without it, AI features return 503; the rest of the app works fine.
- **IRS AFR feed** — set `VIBE_AFR_FEED_URL` to your preferred mirror; the IRS does not publish a JSON feed natively. The fetcher is idempotent on re-run.

## Correctness benchmarks

- **Money math** — never floats. `Money` and `Rate` branded types built on `decimal.js`. The lint config rejects `parseFloat` / `parseInt` / `Number()` in `calc-engine` and `tax-engine`.
- **Tax math** — every calculator carries fixture-based regression tests citing the source IRS Pub or form instructions ($1 tolerance per the build-plan acceptance).
- **Reproducibility** — every tax calculation persists the `tax_year_tables` row IDs it consumed; recomputing a 2024 calc in 2026 produces the identical 2024 result.
- **Audit** — domain mutations write to `audit_events` with a tamper-evident `prev_hash` chain (`/api/v1/audit/chain/validate` checks integrity).

## Vibe-Appliance

The appliance is registered with the [Vibe-Appliance](https://github.com/KisaesDevLab/Vibe-Appliance) console via [`./.appliance/manifest.json`](./.appliance/manifest.json):

- **slug:** `vibe-calculators`
- **subdomain:** `calc.<firm-domain>`
- **emergency port:** 5174
- **Redis db:** 2
- **container names:** `vibe-calculators-server`, `vibe-calculators-client`

The matching console manifest is at `vibe-appliance/console/manifests/vibe-calculators.json` (PR opened during Phase 25 closure).

## Out of scope

- Commercial licensing / Stripe / per-tier enforcement
- Client-facing portals
- Transactional loan servicing (ACH, payment posting, escrow, lockbox)
- Mobile companion app
- Replicating any commercial calculator's visual design — Vibe Calculators implements the _functional_ capabilities described in the build plan with its own visual treatment.
