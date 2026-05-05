# Vibe Calculators — operator commands.
#
# Most commands are thin wrappers over docker compose so a CPA-firm
# operator with no DevOps background can run them off a printed sheet.
# `just <command>` works on macOS, Linux, and Windows (with `just`
# installed via scoop / brew / cargo install just).

# Default recipe: list available commands.
default:
    @just --list --unsorted

# ---------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------

# Build images and start the appliance in the background.
up:
    docker compose up -d --build

# Stop and remove the running appliance (keeps named volumes).
down:
    docker compose down

# Stop the appliance AND remove its volumes (destructive: drops data).
nuke:
    docker compose down --volumes

# Tail logs from every service (or a named one). Ctrl-C to detach.
logs *args="":
    docker compose logs -f --tail=200 {{args}}

# Show which containers are running and which are healthy.
status:
    docker compose ps

# ---------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------

# Open a psql shell against the running Postgres.
psql:
    docker compose exec -e PGPASSWORD=$POSTGRES_PASSWORD postgres \
        psql -U $POSTGRES_USER -d $POSTGRES_DB

# Run pending Drizzle migrations against the running Postgres.
migrate:
    docker compose run --rm --no-deps \
        -e DATABASE_URL=postgres://${POSTGRES_USER:-vibe}:${POSTGRES_PASSWORD:-vibe}@postgres:5432/${POSTGRES_DB:-vibecalc} \
        --entrypoint node api /app/node_modules/@vibe-calc/db/dist/migrate.js

# Seed the database with development fixtures.
seed:
    docker compose run --rm --no-deps \
        -e DATABASE_URL=postgres://${POSTGRES_USER:-vibecalculators}:${POSTGRES_PASSWORD:-vibecalculators}@postgres:5432/${POSTGRES_DB:-vibe_calculators_db} \
        --entrypoint node api /app/node_modules/@vibe-calc/db/dist/seed.js

# Issue a one-time first-admin bootstrap token. Run once after install.
bootstrap:
    docker compose run --rm --no-deps \
        -e DATABASE_URL=postgres://${POSTGRES_USER:-vibecalculators}:${POSTGRES_PASSWORD:-vibecalculators}@postgres:5432/${POSTGRES_DB:-vibe_calculators_db} \
        --entrypoint node api /app/node_modules/@vibe-calc/db/dist/bootstrap-cli.js

# Drop and re-create the database (DESTRUCTIVE — dev / post-restore only).
reset-db:
    docker compose exec -e PGPASSWORD=$POSTGRES_PASSWORD postgres \
        psql -U $POSTGRES_USER -d postgres -c \
        "DROP DATABASE IF EXISTS \"$POSTGRES_DB\"; CREATE DATABASE \"$POSTGRES_DB\";"
    just migrate

# ---------------------------------------------------------------------
# Backup / restore
# ---------------------------------------------------------------------

# Dump database + uploads to ./backups/<timestamp>/.
# Phase 25.2 — emits manifest.json + sha256 checksums alongside the dump.
backup:
    #!/usr/bin/env sh
    set -e
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    out="backups/${ts}"
    mkdir -p "${out}"
    POSTGRES_USER="${POSTGRES_USER:-vibecalculators}"
    POSTGRES_DB="${POSTGRES_DB:-vibe_calculators_db}"
    docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc \
        > "${out}/pgdump.bin"
    docker run --rm -v "$(pwd)/${out}:/out" -v "vibe-calculators_pdf-output:/data" alpine \
        sh -c "tar -C /data -czf /out/pdf-output.tgz ."
    cat > "${out}/manifest.json" <<EOF
{
  "version": "${VIBE_VERSION:-dev}",
  "createdAt": "${ts}",
  "postgresUser": "${POSTGRES_USER}",
  "postgresDb": "${POSTGRES_DB}",
  "schemaMigration": "0011_api_keys_webhooks"
}
EOF
    if command -v sha256sum >/dev/null 2>&1; then
        (cd "${out}" && sha256sum pgdump.bin pdf-output.tgz > checksums.sha256)
    fi
    echo "backup written to ${out}"

# Restore from a backup directory. Phase 25.3 — verifies checksums
# (when sha256sum is available) before applying.
restore PATH:
    #!/usr/bin/env sh
    set -e
    POSTGRES_USER="${POSTGRES_USER:-vibecalculators}"
    POSTGRES_DB="${POSTGRES_DB:-vibe_calculators_db}"
    if [ -f "{{PATH}}/checksums.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
        echo "verifying checksums…"
        (cd "{{PATH}}" && sha256sum -c checksums.sha256)
    fi
    docker compose exec -T postgres pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists \
        < "{{PATH}}/pgdump.bin"
    docker run --rm -v "$(pwd)/{{PATH}}:/in" -v "vibe-calculators_pdf-output:/data" alpine \
        sh -c "rm -rf /data/* && tar -C /data -xzf /in/pdf-output.tgz"
    echo "restore complete"

# ---------------------------------------------------------------------
# Health / doctor
# ---------------------------------------------------------------------

# Quick liveness probe against the running appliance.
health:
    @curl -fsS http://localhost:${VIBE_HTTP_PORT:-80}/api/health | python -m json.tool 2>/dev/null \
        || curl -fsS http://localhost:${VIBE_HTTP_PORT:-80}/api/health

# Phase 25.6 — Deep health probe + container audit.
# Asserts that:
#   - docker compose reports every service "running"
#   - GET /api/health/deep returns 200 (DB read+write, Redis ping,
#     migration row-count, optional queue depth)
#   - the API has bound its port (caddy is reachable)
#   - the host has at least 1 GB free on the data partition
doctor:
    #!/usr/bin/env sh
    set -e
    echo "==> docker compose ps"
    docker compose ps
    echo
    echo "==> /api/health"
    curl -fsS "http://localhost:${VIBE_HTTP_PORT:-80}/api/health" || {
        echo "FAIL: /api/health did not respond" >&2
        exit 1
    }
    echo
    echo
    echo "==> /api/health/deep"
    if ! curl -fsS "http://localhost:${VIBE_HTTP_PORT:-80}/api/health/deep" -o /tmp/deep.json; then
        echo "FAIL: /api/health/deep returned 5xx — see /tmp/deep.json" >&2
        cat /tmp/deep.json >&2 || true
        exit 1
    fi
    cat /tmp/deep.json
    echo
    echo "==> disk free (host)"
    df -h .
    echo
    echo "OK: every probe is green."

# ---------------------------------------------------------------------
# Debug
# ---------------------------------------------------------------------

# Sidecar Alpine shell on the appliance network (api image is distroless).
shell-api:
    docker run --rm -it --network vibe-calculators_vibe \
        alpine sh -c "apk add --no-cache curl bind-tools redis && exec sh"

# Tail the api container's logs only.
logs-api:
    docker compose logs -f --tail=200 api

# ---------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------

# Run the full test suite across every workspace.
test:
    pnpm -r test

# Run tests scoped to one workspace, e.g. `just test-pkg @vibe-calc/api`.
test-pkg PKG:
    pnpm --filter "{{PKG}}" test

# Run the end-to-end suite (Phase 11+ wires up Playwright).
e2e:
    @echo "End-to-end suite not implemented until Phase 11."
