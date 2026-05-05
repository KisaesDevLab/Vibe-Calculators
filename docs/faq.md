# FAQ

Short answers. Longer explanations are linked.

### Is this a TValue replacement?

Yes — for time-value-of-money modeling. The TVM workbench produces
output that matches TValue 6 cents-level. The compute-method dispatch
covers Normal / USRule / RuleOf78 / Canadian / ExactDays. Where
TValue has a feature we don't (e.g. specific report templates), file
an issue with the use case.

It's NOT a TValue replacement for **transactional loan servicing** —
the appliance is a modeling tool, not a system of record for actual
payment receipts.

### Can I use it offline?

Yes. Set `VIBE_OFFLINE=true` in `.env`. The appliance disables
auto-AFR sync, hides cloud AI providers, and runs entirely on the
LAN. Configure a local LLM via `VIBE_LLM_LOCAL_URL` if you want AI
extraction.

### Where's my data stored?

In Postgres + named Docker volumes on the host running the
appliance. Nothing leaves the host except: configured email/AI
provider calls, IRS-AFR fetch, configured webhook deliveries. No
telemetry, no usage beacons.

### Can two firms share one appliance?

No. Single-firm by design. Run a second container.

### Is there a mobile app?

No. Out of scope.

### Why doesn't it support MS SQL / MySQL / Mongo?

Postgres only. The appliance uses Drizzle ORM tied to Postgres-specific
features (JSONB, generated columns, partial indexes, `gen_random_uuid()`).
No plans to abstract.

### Can I export an audit trail to my SIEM?

Yes — subscribe to webhooks (events: `calculation.approve`,
`audit.high_risk` etc.) and your receiver lands them in the SIEM.
Or `COPY audit_events TO STDOUT WITH CSV HEADER` from psql.

### How do I add a new tax-year?

Edit `packages/db/src/seed-tax-tables.ts`, append rows for the new
year, rebuild + restart, run `just seed-tax-tables`. The seeder is
idempotent (skips existing rows). Don't edit existing year rows —
that breaks tax-year reproducibility.

### How do I customize the PDF template?

Edit `packages/pdf/src/pdf.tsx` (amortization), `reg-z.tsx` (Reg Z),
`irr-npv.tsx` (IRR/NPV), `calculator-memo.tsx` (tax memos). Rebuild
the API image. The templates use `@react-pdf/renderer` — same
React component model.

### How do I customize the email template?

Edit `packages/email/src/templates.ts` — six hand-written HTML
templates with inline styles (most clients strip `<style>` blocks,
so inline is the safe path).

### Can a non-admin upload a logo?

No. Logo upload is admin-only via firm-settings PUT. Non-admins read
the public branding subset (firmName, brandColor, logoDataUrl) via
`/api/v1/admin/firm-settings/public`.

### How do I rotate the KMS key?

Generate a new one (`openssl rand -base64 32`), set it in `.env`,
restart. Every existing TOTP enrollment + every API key + every
webhook secret is now unsealable. You'll need to:

1. Force-reset 2FA for every user (Admin → Users → Reset 2FA en
   masse).
2. Revoke + re-issue every API key.
3. Re-enter every webhook secret.

In practice: rotate annually + after any suspected key compromise.
Don't rotate casually.

### Does the appliance support SSO (SAML / OIDC)?

Not yet. Auth is local + magic-link + TOTP. SSO is on the roadmap.

### How do I prevent users from approving their own work?

The route enforces this: a non-admin user cannot approve a
calculation they created (`409 Conflict`). Admins CAN approve their
own work — this is logged in audit_events for review.

### What happens if the API container crashes mid-render?

The export job stays in `processing` status. BullMQ retries up to 3
times with exponential backoff. The retention sweep eventually drops
the half-rendered file (if any). For unattended workloads, the
operator should watch `docker compose logs` for repeated retries —
that signals a deterministic render bug.

### Why does the audit log show some empty payloads?

Some events (e.g. `engagement.archive`) carry only the entity ID; no
additional payload is needed. The hash chain still includes the
empty `{}` so tampering is still detected.

### What's the difference between calc.create and calc.save?

`create` fires when a new calculation is inserted. `save` fires every
subsequent edit (which creates a new version). Webhooks subscribe
to either or both depending on what your downstream cares about.

### Why does setting up the same prompt twice fail?

The `ai_prompts` schema has a unique index on `(kind, version)`.
Inserting the same version twice fails. To author a new revision,
bump the version number.

### Can I run multiple API containers behind a load balancer?

The application is stateless, so yes — but BullMQ workers compete for
queue jobs, which is fine, AND the in-process scheduler tick is
NOT cluster-safe. If you run > 1 API replica, set
`VIBE_SCHEDULER_TICK_INTERVAL_MS=0` on all but one to disable the
duplicate ticks. The export + webhook workers tolerate multiple
replicas.

### Where's the canonical version number?

Every API response footer shows the GIT_SHA. The `/api/health`
endpoint returns `{version, gitSha}` for monitoring scrapers.

### How do I report a security vulnerability?

Email security@your-firm.example with details. Don't file public
GitHub issues for security bugs.
