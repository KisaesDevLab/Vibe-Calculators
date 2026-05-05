# Calculations, versioning, and review

The appliance models a CPA firm's workflow:

```
client → engagement → calculation → version
                                   ↘ comments
```

## Clients & engagements

A **client** is the firm's outside party. Multiple engagements per
client over time.

An **engagement** is a defined scope of work for that client, e.g.
"2024 corporate return," "Q3 2025 tax planning." Engagements have a
preparer + reviewer assignment, status (`prep`, `in_review`, `approved`),
and a tax-year stamp.

## Calculations

A **calculation** lives under exactly one engagement. Examples:
"depreciation schedule for the Cabinetry CNC," "AMT projection,"
"loan modification waterfall."

Every calculation tracks:

- **kind** — TVM, MACRS, RMD, Roth, etc.
- **inputs** — JSON blob, the form values
- **outputs** — JSON blob, the computed result
- **status** — `draft`, `ready_for_review`, `approved`
- **current_version_id** — pointer into `calculation_versions`

## Versioning

Every save creates an immutable **version** row. The pointer
`current_version_id` advances; old versions stay forever. To
"undo" a bad save, **rollback** creates a NEW version that copies the
old payload — the original is never overwritten.

Approved versions are **locked** — the inputs/outputs JSON is frozen,
and any further edit must produce a new version with status reset to
`draft`. The lock is recorded in the audit chain (see below).

## Review workflow

```
draft  ──▶  ready_for_review  ──▶  approved
   ▲              │
   └──────────────┘    (reject)
```

- A preparer marks a calculation **ready for review**.
- A reviewer (different user) **approves** or **rejects** with a reason.
- Rejection sends the calculation back to draft and posts the reason
  as a calculation comment.
- A user cannot approve their own calculations except as admin (which
  is logged).

## Comments

Each calculation has a comment thread. Authoring a comment is a single
audit-event; replies thread by reference. Use comments to capture
review questions ("can you confirm the asset cost?") and reviewer
responses.

## Audit chain

Every state-changing action lands a row in `audit_events` with a
sha256 hash that incorporates the previous row's hash — a tamper chain.
The validator at **Admin → Audit log** walks the table; if any row's
content was edited or deleted, the chain breaks and the validator
identifies the first divergent row.

Audit events covered:

- `calculation.create` / `save` / `submit_for_review` / `approve` /
  `reject` / `rollback` / `archive` / `restore` / `lock`
- `engagement.transition` / `assign` / `archive`
- `client.update` / `archive`
- `bulk.archive` / `bulk.reassign` / `bulk.change_tax_year`
- `export.created` / `downloaded`
- `backup.created` / `backup.restore.requested`

## Bulk actions

The Calculations index supports bulk archive, reassign, and tax-year
change on selected rows. Each lands one bulk-event row plus per-target
audit events.

## Soft delete

Archive is soft — the `archived_at` timestamp is set, the row stays.
Restore unsets it. Hard-delete is admin-only via a CLI tool, not the
UI; it bypasses the audit chain so use with care.

## My queue

The **My queue** sidebar entry lists engagements assigned to you, with
an SLA flag for any in `in_review` for more than 3 days. It also lists
calculations awaiting your review.

## Tags

Calculations and clients can be tagged. Free-form, autocomplete on the
firm's existing tag set. Useful for ad-hoc grouping ("year-end review,"
"REIT analysis"). Tag operations land in the audit chain.
