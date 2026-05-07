# Install & upgrade

How to stand up the appliance on a clean Ubuntu 24.04 LTS box (or
any Docker-capable host).

## Prerequisites

- **Docker Engine 24+** with Compose v2.
- **Node 20+** (only for running the `vibecalc-installer` script;
  the appliance itself runs in distroless containers).
- **Ports 80 + 443** free on the host (or pick alternatives via
  `VIBE_HTTP_PORT` / `VIBE_HTTPS_PORT`).
- **4 vCPU, 16 GB RAM, 256 GB SSD** minimum (NucBox M6-class). The
  appliance will run on smaller hosts but PDF rendering and AI
  inference get sluggish.

## First-run install

```sh
# Clone the repo (or download the latest release tarball)
git clone https://github.com/your-firm/vibe-calculators.git
cd vibe-calculators

# Run the installer
./bin/vibecalc-installer.mjs install
```

The installer prompts for:

- Firm name
- Deploy mode (lan / domain / tailscale)
- Public domain + ACME email (only if domain mode)

It then:

1. Generates random secrets (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
   `VIBE_KMS_KEY`) and writes `.env`.
2. Pulls the Docker images.
3. Runs `docker compose up -d --build`.
4. Runs database migrations.
5. The API container seeds a default admin (`admin@local` /
   `vibe-admin-changeme`) on first boot when the users table is
   empty, and prints the credentials to its log.

Open the appliance URL, sign in with the default credentials. You
will be required to set a new password before any other navigation
succeeds. The default password works exactly once.

## Manual install (no installer)

If you prefer not to run the installer script:

```sh
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, REDIS_PASSWORD, VIBE_KMS_KEY
docker compose up -d --build
just migrate
docker compose logs --no-log-prefix api | grep -A 6 'default admin seeded'
# → prints the default admin credentials
```

The seed runs automatically the first time the API starts against an
empty users table; nothing else needs to happen out-of-band.

## Upgrading

```sh
./bin/vibecalc-installer.mjs upgrade
```

This:

1. Takes a pre-upgrade backup snapshot (encrypted by default).
2. `docker compose pull` — fetches newer images.
3. Runs any pending migrations.
4. `docker compose up -d --no-build` — restart with new images.

Migrations are forward-only and never destructive. The audit chain
survives upgrades.

If something goes wrong, restore from the pre-upgrade snapshot:

```sh
./bin/vibecalc-installer.mjs restore ./backups/<pre-upgrade-timestamp> --i-know
```

## Uninstalling

```sh
# Stop containers, keep volumes (recoverable)
./bin/vibecalc-installer.mjs uninstall

# Stop AND wipe volumes (DESTRUCTIVE)
./bin/vibecalc-installer.mjs uninstall --purge --i-know
```

`--purge` removes Postgres data, exports volume, and backups volume.
There's no recovery after `--purge --i-know` — the data is gone.

## Health checks

```sh
./bin/vibecalc-installer.mjs status   # docker compose ps + /api/health
./bin/vibecalc-installer.mjs doctor   # deep health: DB write, Redis, migrations
```

The doctor command exits non-zero if any probe fails — wire it into
your monitoring stack as a healthcheck.

## Common installation issues

**`Error: pull access denied for ghcr.io/kisaesdevlab/...`**

The image isn't published to GHCR yet, or your account lacks pull
access. Build locally:

```sh
docker compose build
```

then `docker compose up -d` again.

**`POSTGRES_PASSWORD must be set in .env`**

The compose file refuses to start if the password env is unset.
Check that `.env` exists and has `POSTGRES_PASSWORD=` followed by a
non-empty value. The installer auto-generates this — if you ran the
manual install, set it yourself with `openssl rand -hex 24`.

**`port already allocated`**

Ports 80/443 are taken on the host. Either stop the conflicting
service or remap:

```sh
# .env
VIBE_HTTP_PORT=8080
VIBE_HTTPS_PORT=8443
```

Then `docker compose up -d` again.

**`distroless: exec: "node": executable file not found`**

Old version of the installer or justfile. Use the current ones — they
invoke `--entrypoint /nodejs/bin/node` and service
`vibe-calculators-server` (not `node` and `api`).

**Healthcheck fails after upgrade**

The schema-version probe asserts the migration count matches what the
API was built against. If you bumped the count without running
`just migrate`, the probe fails. Run migrations + restart.
