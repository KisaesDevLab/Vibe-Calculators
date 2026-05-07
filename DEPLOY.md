# Vibe Calculators — Deployment Guide

Self-hosted Docker appliance for a single CPA firm. This document is the operator-facing manual.

## Resource sizing

| Tier        | vCPU |   RAM |    SSD | Concurrent users | Notes                                                                                                                           |
| ----------- | ---: | ----: | -----: | ---------------: | ------------------------------------------------------------------------------------------------------------------------------- |
| Minimum     |    4 | 16 GB | 256 GB |        up to ~15 | NUC-class box (e.g. NucBox M6). 30-year monthly amortization renders < 200 ms; 100-row tax-calc memo PDF < 500 ms.              |
| Recommended |    8 | 32 GB | 512 GB |        up to ~50 | Sustained workload + AI extraction (Anthropic API calls). Postgres has more headroom for FTS over a year of saved calculations. |
| Large       |   16 | 64 GB |   1 TB |             100+ | Multi-office firm with per-team dashboards. Add a managed Postgres backup target.                                               |

Disk budget at 50 active staff CPAs after 12 months:

- Postgres data: ~5–10 GB (calculations + versions + audit-events; FTS index is the largest line)
- PDF/XLSX/DOCX exports retained 30 days: ~2 GB
- Backups (7 daily / 4 weekly / 12 monthly with `pg_dump -Fc`): ~30 GB
- Container images: ~2 GB (caddy + redis + postgres + 2 app images)

## Prerequisites

- Linux host (Ubuntu 24.04 LTS recommended; Windows + macOS work for development but the appliance is shipped for Linux production)
- Docker Engine ≥ 24 with the Compose v2 plugin
- Open ports: 80 + 443 (or `VIBE_HTTP_PORT` / `VIBE_HTTPS_PORT` overrides if those are taken)
- Outbound HTTPS to `api.anthropic.com` if AI loan-extraction is enabled
- (Optional) Tailscale CLI if running in `tailscale` deploy mode

## First-run install

1. Clone or copy the appliance directory.
2. Copy `.env.example` to `.env` and fill in:
   - `POSTGRES_PASSWORD` — `openssl rand -base64 32`
   - `REDIS_PASSWORD` — `openssl rand -base64 32`
   - `VIBE_KMS_KEY` — `openssl rand -base64 32` (32 raw bytes, base64). Required in production. **Back this up off-host.** Losing it means TOTP secrets and webhook secrets become unrecoverable.
   - `VIBE_DEPLOY_MODE` — one of `lan` / `domain` / `tailscale`
   - For `domain` mode: `VIBE_DOMAIN` and `VIBE_TLS_EMAIL`
   - `VIBE_HTTP_PORT` / `VIBE_HTTPS_PORT` — only if 80/443 are in use
   - `VIBE_OFFLINE=true` if the appliance won't have internet (disables AFR auto-update + AI)
   - Optional: `ANTHROPIC_API_KEY` + `VIBE_LLM_DEFAULT_MODEL` for AI loan-extraction
3. `just up` (or `docker compose up -d`) — first run pulls images and builds containers (~2–5 min)
4. `just migrate` — applies Drizzle migrations
5. The API container seeds `admin@local.test` / `vibe-admin-changeme` on first boot when the users table is empty, and logs the credentials. Retrieve with `docker compose logs --no-log-prefix api | grep -A 6 'default admin seeded'`.
6. Open `http://<host>:<VIBE_HTTP_PORT>/login` (or `https://<VIBE_DOMAIN>/login` in domain mode), sign in with the default credentials, and pick a new password when prompted. The default works exactly once.
7. Sign in. Visit `/admin/firm-settings` and set firm name, EIN, address, brand color, logo (optional, ≤ 1 MB), PDF footer.
8. (Optional) Visit `/admin/ai` to verify Anthropic connectivity by sending a test prompt.

## Deploy modes

### `lan` (default)

Plain HTTP on `VIBE_HTTP_PORT`. Use behind firm-internal firewall or Tailscale subnet routing. No HSTS — the appliance can be served on http for years and a future migration to https won't browser-cache itself out.

### `domain`

Caddy provisions a Let's Encrypt certificate for `VIBE_DOMAIN` automatically. HSTS is emitted (max-age 1y, includeSubDomains). Requires:

- DNS A/AAAA pointing the domain at the host
- 80 + 443 reachable from the public internet (for ACME http-01 challenge)
- A valid email at `VIBE_TLS_EMAIL` (Let's Encrypt expiry warnings)

### `tailscale`

The appliance binds plaintext on `VIBE_TS_PORT` (default 8000) inside the container. The host runs `tailscale serve` to terminate TLS at the Tailscale layer. Useful for firm-internal access without public DNS.

## Health checks

```bash
just health        # GET /api/health  → basic up/connected status
just doctor        # GET /api/health/deep + container audit + disk free
```

`/api/health` is suitable for upstream load balancer / systemd liveness probes. `/api/health/deep` exercises the read+write DB path, Redis SET/GET/DEL, migration row count, optional BullMQ queue depth — use for monitoring or on-call paging.

## Backup + restore

Encrypted nightly is **not** built in (deferred from Phase 25.7). For now:

```bash
just backup            # writes backups/<timestamp>/{pgdump.bin, pdf-output.tgz, manifest.json, checksums.sha256}
just restore PATH      # verifies sha256 then pg_restore + uploads
```

Recommended retention: copy `backups/` into your firm's offsite backup target nightly. The directory is self-contained.

## Upgrade

```bash
git pull
just up         # rebuilds images
just migrate    # applies any new migrations forward-only
```

Migrations are forward-only (Drizzle convention). To roll back, restore from the most recent pre-upgrade backup. Always `just backup` before `just migrate` on a production host.

## Deploy-mode switching

Edit `.env`'s `VIBE_DEPLOY_MODE` and:

```bash
docker compose down
just up
```

The Caddyfile reads the env var at boot and includes the matching snippet from `caddy/snippets/`. Switching modes does **not** require regenerating any database state.

## Operations runbook

### "I can't log in"

1. `just doctor` — confirm services are running and DB+Redis are healthy
2. Check container logs: `docker compose logs -f vibe-calculators-server`
3. The appliance enforces 5-failed-login lockout per `(IP, email)` for 15 min. An admin can clear via `/admin/users` → user detail → "Clear lockout".
4. Last-resort: drop the locked admin row in `psql` and restart the API container — the seeder will re-create `admin@local.test` / `vibe-admin-changeme` (with `must_change_password=true`) the next time it boots against an empty users table.

### "AI extraction returns 503"

1. Visit `/admin/ai` — verify status
2. Check `ANTHROPIC_API_KEY` in `.env` (must be present and start with `sk-ant-`)
3. Visit `/admin/ai` and click **Send test prompt**
4. If `VIBE_OFFLINE=true`, AI is intentionally disabled. Set `VIBE_OFFLINE=false` and restart the server container.

### "Tax calculations don't match what I expect"

1. Tax-year tables are pinned per save (Phase 14.4). Rerun the calc against the _current_ year's tables to see if it diverges.
2. Visit `/admin/audit` and search for the calculation's id — every recompute is recorded.
3. Open `/calculations/<id>/versions` and side-by-side the two versions to spot the differing input.

### "I lost my VIBE_KMS_KEY"

There is no recovery. The appliance can boot (the env validator will refuse) but historical TOTP secrets and webhook signing secrets are unreadable. Reset path:

1. Restore the most recent backup taken before key loss
2. If no such backup exists, accept the loss — wipe the database, let the seeder re-create the default admin on next API boot, instruct every user to re-enroll TOTP, re-issue every API key + webhook subscription.

**Always back up `VIBE_KMS_KEY` to a separate secret store the moment you generate it.**

## What's deferred

The build plan called for a few operator-facing items that aren't shipped yet. Workarounds in the meantime:

| Build-plan item                                  | Status                                       | Workaround                                                   |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| `vibecalc-installer` CLI binary                  | not shipped                                  | use `just up` / `just migrate` instead                       |
| Encrypted backups + 7d/4w/12m retention rotation | partial — `just backup` works, no encryption | wrap the backup directory with `age` or `gpg`, copy off-host |
| Restore wizard UI                                | not shipped                                  | use `just restore PATH`                                      |
| MJML-rendered email templates                    | not shipped                                  | magic-link + invitation emails are plain-text                |
| BullMQ async export queue                        | not shipped                                  | exports run synchronously (fine up to ~50 concurrent users)  |
| Per-user email digest preferences                | not shipped                                  | every email recipient gets immediate delivery                |

None of these block the core CPA workflow (build → save → version → review → export). Each is incremental polish above a working baseline.
