# Troubleshooting

Common errors and how to recover.

## Quick health checks

```sh
./bin/vibecalc-installer.mjs status     # are containers up?
./bin/vibecalc-installer.mjs doctor     # deep DB/Redis/migration probe
docker compose logs -f vibe-calculators-server | tail -100
```

The deep doctor probe should print `OK: every probe is green.` when
everything's working.

## Default admin credentials are lost

The seeder only runs when the users table is empty. If you never set a
real password and have forgotten the default, the recovery is to wipe
the admin row in `psql` and restart the API container — the seeder
will recreate `admin@local.test` / `vibe-admin-changeme` (with
`must_change_password=true`) on next boot. If multiple users exist,
restore from a backup or follow the "Wipe and reinstall" recipe below.

## Sign-in redirects to /onboarding/change-password

Working as designed. The seeded default admin carries
`must_change_password=true`; the SPA gates every other route until
you set a real password. Pick a ≥12-character password that isn't on
the common-list and submit — you will land on `/calculators` and
the flag is cleared.

## Magic-link emails are not arriving

Check, in order:

1. **Email provider configured?** `docker compose logs
vibe-calculators-server | grep "email provider"` should say
   `email provider ready`. If it says `not configured — magic-link
emails will be logged only`, the magic-link URL is in the logs;
   copy and send manually.
2. **Provider env vars set?** For SMTP: `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Restart after editing.
3. **Test from inside the container**:
   ```sh
   docker compose exec vibe-calculators-server /nodejs/bin/node -e \
     "fetch('http://smtp.firm.test:587').then(r => console.log(r.status))"
   ```
   A 4xx is fine — it means the host is reachable. ECONNREFUSED means
   the SMTP host is unreachable (firewall? wrong host?).
4. **Spam filter**: check the recipient's spam folder. Hand-written
   HTML emails sometimes flag without DKIM/SPF.

## API health probe fails

**Symptom**: docker reports `vibe-calculators-server` as unhealthy.

```sh
docker compose logs vibe-calculators-server | tail -50
curl -v http://localhost:5174/api/health
```

Common causes:

- **Postgres not reachable**: the deps `condition: service_healthy`
  in compose should prevent boot until Postgres is up. If Postgres
  itself is failing, check `docker compose logs postgres`.
- **Migration count mismatch**: the deep-health probe asserts
  `applied=N` matches the version baked into the API. After an
  upgrade, run `just migrate` then restart.
- **Worker concurrency starvation**: see "Slow exports" below.

## Slow exports / "rendering" forever

PDF rendering is CPU-bound. With concurrency=1 (the default), an
8-MB schedule can take 10+ seconds.

```sh
docker compose logs vibe-calculators-server | grep "export job"
```

If you see jobs sitting in `processing` for minutes, check:

- **CPU pressure**: `docker stats` should show
  `vibe-calculators-server` near 100% during the render. If it's
  sitting at 0% the worker is stuck — try restarting the server
  container.
- **Healthcheck thrashing**: the Docker healthcheck has a 3s timeout.
  If a render is blocking the event loop past 3s, the healthcheck
  fails and Docker can restart the container mid-render. The
  default concurrency=1 leaves headroom for the HTTP loop, but if
  you bumped `VIBE_EXPORT_CONCURRENCY` and started seeing restarts,
  drop it back to 1.

## Webhook deliveries failing

Visit **Admin → Webhooks → Deliveries** to see attempt history per
subscription.

```
Status: retrying — last failure: HTTP 500 (3 attempts)
```

The retry ladder is 5/15/60/300/1800 seconds; after 5 failures the
row goes to `dead`. Click **Redrive** on a dead row to re-enqueue.

Common failure modes:

- **DNS rebinding guard**: the URL's hostname resolved to a
  private/loopback IP at delivery time. Check that your endpoint's
  DNS isn't being rewritten by a captive portal or your firm's
  DNS server.
- **HTTPS cert expired**: the receiver's TLS cert chain is invalid.
  Check with `curl -v <url>` from a third host.
- **HMAC verification failing on the receiver side**: confirm the
  receiver computes `HMAC-SHA256(secret, "<unix-ts>." + body)` —
  the dot is a literal character.

## Calc engine refuses non-Normal compute method

```
ScheduleGenerationError: ComputeMethod 'RuleOf78' is declared but not
yet implemented in the schedule engine.
```

If you're seeing this on a current build, your build is older than the
fix. Pull `main` and rebuild — every compute method works in the
released code.

## Database migration fails

```
[migrate] failed: relation "audit_events" already exists
```

Drizzle's migration runner replays from the journal; if a migration
was partially applied (e.g. interrupted by Ctrl-C), the journal
thinks it's still pending while the schema is already updated.

Fix:

```sh
docker compose exec postgres \
  psql -U vibecalculators -d vibe_calculators_db \
  -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;"
```

If the failed migration's `tag` is missing from the table but its
schema is present, manually insert:

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('<from-the-_journal.json-snapshot>', now());
```

Then re-run `just migrate`.

## "Backup volume not mounted" in restore wizard

**Symptom**: **Admin → Backups** shows `No snapshots`.

**Cause**: the `backups` volume mount on `vibe-calculators-server` is
missing — older builds didn't include it.

**Fix**: confirm `docker-compose.yml` has the line
`- backups:/data/backups:ro` under the server's `volumes:` block, and
that the `backups:` named volume is declared in the `volumes:` block
at the bottom. `docker compose up -d --build` to apply.

## Wipe and reinstall

Last resort. **DESTRUCTIVE.**

```sh
./bin/vibecalc-installer.mjs uninstall --purge --i-know
rm -f .env
./bin/vibecalc-installer.mjs install
```

This drops every database, every uploaded file, every export,
every backup. The data is gone.

## Where to file bugs

- **GitHub Issues**: https://github.com/your-firm/vibe-calculators/issues
- Include: `vibecalc-installer doctor` output, last 50 lines of
  `docker compose logs vibe-calculators-server`, the build version
  (top-right of any page footer), and a step-by-step repro.
