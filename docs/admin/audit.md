# Admin → Audit log

Tamper-evident ledger of every state-changing action.

## How the chain works

Each row computes:

```
row_hash = sha256( prev_hash || "|" || canonical(record) )
```

where `canonical(record)` deterministically serializes the record's
columns (sorted keys, ISO-formatted timestamps, dropping undefineds).

The first row's `prev_hash` is the GENESIS sentinel (`g0000…0000`).
Each subsequent row's `prev_hash` is the prior row's `row_hash`.

This means: edit any row's payload (or delete a row, or insert a fake
one), and every subsequent row's `prev_hash` no longer matches —
the chain breaks at the tampered row.

## Validator

The validator endpoint walks `audit_events` chronologically and:

1. Checks every row's `prev_hash` matches the prior row's `row_hash`.
2. Recomputes each row's `row_hash` from its payload + reported
   `prev_hash` and compares to the stored value.

The first failure is the row where tampering occurred. The validator
returns the row ID + a short "expected ... got ..." mismatch report.

Click **Validate chain** at the top of the audit log page. A green
checkmark means the chain is intact; a red banner shows the broken
row.

## What gets logged

| Action                                                                | Trigger                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `calculation.create`                                                  | New calc inserted.                                  |
| `calculation.save`                                                    | Calc inputs/outputs updated → new version.          |
| `calculation.submit_for_review`                                       | Status: draft → ready_for_review.                   |
| `calculation.approve`                                                 | Reviewer approved.                                  |
| `calculation.reject`                                                  | Reviewer rejected with reason.                      |
| `calculation.rollback`                                                | Restore from a prior version (creates new version). |
| `calculation.archive` / `restore`                                     | Soft-delete toggle.                                 |
| `calculation.lock`                                                    | Approval locked the version.                        |
| `calculation.comment`                                                 | Comment added to the thread.                        |
| `engagement.create` / `transition` / `assign` / `archive` / `restore` | Engagement lifecycle.                               |
| `client.create` / `update` / `archive` / `restore`                    | Client lifecycle.                                   |
| `tag.attach` / `detach`                                               | Tag operations.                                     |
| `bulk.archive` / `reassign` / `change_tax_year`                       | Multi-target ops, one row per bulk + per-target.    |
| `export.created` / `downloaded`                                       | Export queued / streamed to client.                 |
| `backup.created`                                                      | Backup snapshot completed.                          |
| `backup.restore.requested`                                            | Restore wizard confirmed.                           |

## Browsing

The page lists rows newest-first. Each row shows:

- Timestamp (firm timezone)
- Action (e.g. `calculation.approve`)
- Entity (kind/id excerpt)
- Actor (user id excerpt or `system`)
- Hash (first 12 chars of `row_hash`)

Click any row to expand and see the full JSON payload — what changed,
the input that caused it, the version IDs involved, etc.

## Drill-down filters

- **Action** — filter to a single action type.
- **Entity** — show only events for one calculation/engagement/client.
- **Actor** — show only events caused by a specific user.
- **Date range** — preset windows (today, this week, this month) +
  custom.

## Retention

Audit rows are insert-only. There's no delete from the UI, no edit
ever. The chain is meant to outlive the data it audits — even after
a calculation is hard-deleted (admin SQL), the audit rows stay.

The DB grows ~1 KB per audit row. At 1000 firm-days × 50 actions/day
that's 50 MB/year — comfortably negligible.

## Export the chain

```sh
docker compose exec postgres \
  psql -U vibecalculators -d vibe_calculators_db \
  -c "COPY audit_events TO STDOUT WITH CSV HEADER" \
  > audit-export-$(date +%F).csv
```

Useful for handing the chain to an external auditor. The validator
function is reproducible from the SQL alone — no app code needed.

## When the chain breaks

- **Confirm tampering vs. bug**: re-run the validator twice. Bugs
  are typically deterministic; transient breakage is usually a
  race condition in the writer (file an issue).
- **Find the broken row**: the validator points to the first
  divergent row. Inspect the row immediately before it — that's
  the last row whose hash is provably correct.
- **Investigate**: who had DB write access at that timestamp? Audit
  the Postgres connection log (`log_statement = 'mod'` if turned on).
  The auth_events chain is separate; cross-reference if relevant.
- **Recover**: there's no way to "fix" a broken chain — by design.
  You can prove the rows after the break aren't trustworthy. For
  ongoing operation, the chain continues from the corrupt row's
  `row_hash`; new operations append normally. The audit history
  before the break is still intact.

## What this is NOT

- Not a tamper-PROOF chain. A sufficiently determined attacker with
  superuser DB access can rewrite every row's hash to be self-consistent.
  This chain is tamper-EVIDENT: rewriting requires every subsequent
  row's hash to be recomputed, and any partial tampering (or simple
  deletion) breaks the chain visibly.
- Not a write-ahead log. Postgres has `pg_wal` for that.
- Not a SIEM. For real security monitoring, ship audit_events to your
  SIEM via the webhook subscriptions.
