# Backup & restore (operator)

For the user-facing wizard, see [Admin → Backups](../admin/backups.md).
This document covers the host-side mechanics.

## Daily backup recipe

```sh
# Runs nightly via cron / systemd timer. Encrypted by default.
0 2 * * * cd /opt/vibe-calculators && \
  ./bin/vibecalc-installer.mjs backup >> /var/log/vibe-backup.log 2>&1
```

The backup:

1. Calls `pg_dump -Fc` against the running Postgres.
2. Tarballs `/data/exports` from the `pdf-output` volume.
3. AES-256-CBC + PBKDF2 encrypts both files (passphrase from
   `VIBE_BACKUP_PASSPHRASE`).
4. Writes manifest.json.
5. Copies the snapshot into the `backups` Docker volume so the
   restore wizard at `/admin/backups` can list it.

## Off-site replication

After the daily backup completes, ship the encrypted snapshot off-site:

```sh
0 3 * * * rsync -av --remove-source-files \
  /opt/vibe-calculators/backups/ \
  user@offsite.example:/srv/vibe-backups/firm-name/ \
  >> /var/log/vibe-rsync.log 2>&1
```

`--remove-source-files` removes the host copy after a successful
rsync — but the Docker volume copy stays so the restore wizard can
still see it.

For S3-compatible targets:

```sh
aws s3 sync /opt/vibe-calculators/backups/ \
  s3://firm-vibe-backups/ \
  --delete \
  --storage-class GLACIER_IR
```

Encryption is end-to-end: the off-site target sees only ciphertext,
so any cloud target is acceptable.

## Restore

```sh
# Auto-detects encrypted (.enc) or plaintext snapshots.
./bin/vibecalc-installer.mjs restore /opt/vibe-calculators/backups/<timestamp> --i-know
```

The restore:

1. If the snapshot is encrypted, decrypts in place using
   `VIBE_BACKUP_PASSPHRASE` from `.env`.
2. `pg_restore --clean --if-exists` drops every table and
   reinstates from the dump.
3. Wipes `/data/exports` and untars the export volume.

After the CLI exits, every active session is invalidated (the sessions
table was dropped + restored). Sign back in with the credentials
that existed at backup time.

## Manual encrypted backup, no installer

If you'd rather use `just`:

```sh
just backup-encrypted
```

This wraps `just backup` + `age -p` encryption. Requires `age`
on PATH (https://age-encryption.org). Same passphrase semantics as
the installer.

## Retention rotation

The recipe trims old snapshots on a 7-daily / 4-weekly / 12-monthly
schedule. Override via env:

```sh
VIBE_BACKUP_DAILY=14
VIBE_BACKUP_WEEKLY=8
VIBE_BACKUP_MONTHLY=24
```

Run after each backup; old snapshots fall out of the window and get
unlinked. Files in the off-site replication target are NOT touched —
manage retention there separately.

## What you CAN'T restore

- **`.env`**: not in the snapshot. Encrypt and store this alongside
  your off-site backups.
- **Caddy TLS state**: rebuilds on first HTTPS request. Brief outage
  on first re-deploy.
- **Redis BullMQ queues**: ephemeral; in-flight jobs are lost. The
  durable status (`webhook_deliveries`, `export_jobs`) survives in
  Postgres so retries pick up where they left off.

## DR drill (quarterly recommended)

1. Stand up a fresh appliance on a test box (different host).
2. Copy the most recent backup to `./backups/<timestamp>/`.
3. Set the same `VIBE_BACKUP_PASSPHRASE` in the test box's `.env`.
4. Run `vibecalc-installer restore ./backups/<timestamp> --i-know`.
5. Sign in with the prior admin credentials.
6. Verify a sampled calculation reproduces correctly.

If step 5 fails (admin can't sign in) or step 6 fails (calc result
diverges from what was archived), the production snapshot is broken
or the passphrase is wrong — escalate.

## Forensics

If you suspect tampering or corruption between backups:

```sh
# Compare two adjacent snapshots
diff <(openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 \
       -in backup-A/pgdump.bin.enc) \
     <(openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 \
       -in backup-B/pgdump.bin.enc) | head -50
```

Or restore both into separate test instances and run the audit-chain
validator on each — divergence in the chain hash is the signal.

## Cold-storage long-term retention

For multi-year retention (regulatory, statute-of-limitations):

- Keep the `manifest.json` + `pgdump.bin.enc` from the last day of
  each tax year on a separate medium (LTO tape, M-Disc, deep
  archival cloud).
- Document the passphrase generation policy. **Lost passphrase =
  lost backup.** A passphrase manager (1Password, Bitwarden) +
  printed copy in the firm safe is the standard split.
- Retest restore at least once per year — passphrase rotation
  silently breaks recovery if you don't.
