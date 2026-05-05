# Admin → Backups & restore

Snapshots of the appliance state. Encrypted by default. The restore
wizard guides recovery from the UI; the actual destructive replace
runs via the host CLI (the API container is read-only and can't run
`pg_restore`).

## What's in a backup

```
backups/<timestamp>/
  ├─ pgdump.bin.enc         (Postgres custom-format dump, AES-256-CBC)
  ├─ pdf-output.tgz.enc      (export volume tarball, AES-256-CBC)
  ├─ checksums.sha256        (sha256 of both ciphertexts)
  └─ manifest.json           (version, createdAt, db user, encrypted: true)
```

What this captures:

- Every Postgres table (users, calculations, schedules, audit_events,
  …)
- Every export rendered in the last 30 days (the `pdf-output` volume)
- Schema version metadata

What this does NOT capture:

- Redis contents (BullMQ queues, rate-limit counters). These are
  ephemeral and rebuild on first use.
- The `.env` file — that's your responsibility (encrypt and store
  alongside).
- Caddy state (auto-generated TLS certificates rebuild on first
  request).

## Encrypted by default

`vibecalc-installer backup` encrypts both files with AES-256-CBC +
PBKDF2 (200k iterations) before they hit disk. The passphrase comes
from `VIBE_BACKUP_PASSPHRASE` in your `.env`; missing the env blocks
the backup unless you pass `--plaintext` (which you should NOT use
for off-site storage).

To rotate the passphrase: change `VIBE_BACKUP_PASSPHRASE`, run a fresh
backup, securely delete the older snapshots. Old encrypted snapshots
are unrecoverable without the previous passphrase.

## Creating a backup

```sh
# On the host:
vibecalc-installer backup
```

The CLI:

1. Calls `pg_dump -Fc` against the running Postgres.
2. Tarballs `/data/exports` from the `pdf-output` volume.
3. AES-256-CBC encrypts both files.
4. Writes `manifest.json`.
5. Copies the snapshot into the `backups` Docker volume.

The copy into the docker volume is what makes the snapshot visible to
the **Admin → Backups** page (read-only mount).

## Restore wizard

Open **Admin → Backups**. The page lists snapshots ordered by created
date. To restore:

1. Click the radio button next to the snapshot.
2. Type `DESTRUCTIVE-REPLACE` in the confirmation field.
3. Click **Confirm restore intent**.

The API:

- Records a `backup.restore.requested` audit row tying your user +
  IP to the intent.
- Returns the operator-side command:

```sh
vibecalc-installer restore /data/backups/<timestamp> --i-know
```

You then run that command **on the host shell**. The restore:

1. Detects whether the snapshot is `.enc` (encrypted) or plaintext.
2. If encrypted, decrypts with `VIBE_BACKUP_PASSPHRASE`.
3. `pg_restore --clean --if-exists` drops every table and reinstates.
4. Wipes `/data/exports` and untars the snapshot.

After the CLI finishes, sign out + back in (your session was wiped
along with the rest of the DB).

## Why is the wizard split between UI and CLI?

The API container runs read-only with the root filesystem locked. It
deliberately can't run `pg_restore` directly — that would require
elevated privileges + write access to the data directory + arbitrary
shell execution, which violates the appliance's security posture.

The split design ties the operator's UI confirmation (audit row) to
the eventual filesystem-level operation, while keeping the API
container hardened.

## Retention

The `vibecalc-installer backup-encrypted` recipe (delegates to
`just backup-encrypted`) supports a 7-daily / 4-weekly / 12-monthly
retention rotation. Override via env:

- `VIBE_BACKUP_DAILY=14` — keep two weeks of daily snapshots
- `VIBE_BACKUP_WEEKLY=8` — keep two months of weekly snapshots
- `VIBE_BACKUP_MONTHLY=24` — keep two years of monthly snapshots

The rotation runs after each successful backup; old snapshots get
unlinked from the host directory but stay in the Docker volume until
manually removed.

## Off-site replication

The host directory `./backups/` is plain files. To replicate off-site:

- `rclone sync ./backups/ remote:vibe-backups/` for any cloud target.
- `rsync -av ./backups/ user@offsite:/srv/vibe-backups/` for a sibling
  host.
- An `s3cmd put` or direct `aws s3 sync` if you have an S3 bucket.

Encryption is end-to-end: the snapshots are AES-encrypted before they
leave the appliance, so any off-site provider sees only ciphertext.

## Disaster recovery drill

Recommended quarterly:

1. Stand up a fresh appliance on a test box.
2. Copy the most recent backup to `./backups/<timestamp>/`.
3. Run `vibecalc-installer restore ./backups/<timestamp> --i-know`.
4. Sign in with the prior admin credentials.
5. Verify a sampled calculation reproduces correctly.

If step 5 fails, the production snapshot is broken — escalate.
