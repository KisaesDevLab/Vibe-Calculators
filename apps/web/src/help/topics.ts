/**
 * Help topic catalog. Mirrors /docs/ in the repo but inlined as
 * runtime strings so the app can show them offline. Markdown is
 * rendered with a small subset (headings, lists, code, links)
 * — see Help.tsx renderMarkdown.
 *
 * Keep entries short and action-oriented. Long explanations go in
 * /docs/ Markdown; the in-app version is the "what's the next click?"
 * tier.
 */

export interface HelpTopic {
  id: string;
  title: string;
  category: "user" | "admin" | "operator" | "reference";
  /** Searchable keyword list — tokenizes on space + lowercases. */
  keywords: string[];
  body: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    category: "user",
    keywords: ["start", "first", "login", "navigate", "intro"],
    body: `## Sign in

Three paths: **email + password** (with TOTP if 2FA is enabled), **magic link** (open the email and click), or a **single-use recovery code** if you've lost your authenticator.

After sign-in you land on **Calculators**. The left rail is your nav; the top bar holds search (\`⌘K\` / \`Ctrl-K\`).

## Run your first calc

The fastest first calculation is a TVM amortization:

1. **Calculators → TVM workbench**.
2. Row 1: kind = \`loan\`, amount = e.g. \`100000\`, today's date.
3. Row 2: kind = \`payment\`, amount = \`1933.28\`, count = \`60\`, interval = \`monthly\`.
4. The schedule recomputes as you type. Click **Save** to capture it as a calculation under a client + engagement.

## Stay efficient

- \`⌘K\` opens the command palette — type any calculator name, client, or engagement.
- **My queue** lists engagements assigned to you with an SLA flag for things sitting > 3 days.
- **Exports** is your inbox for queued PDF / XLSX renders.`,
  },
  {
    id: "workbench",
    title: "TVM workbench",
    category: "user",
    keywords: ["tvm", "workbench", "amortization", "loan", "schedule", "events"],
    body: `## Grid columns

| Column   | Use                                                   |
| -------- | ----------------------------------------------------- |
| Date     | Type \`+1m\` to advance 1 month from the row above.    |
| Kind     | \`loan\`, \`payment\`, \`balloon\`, \`rate_change\`, etc. |
| Amount   | Dollar value. Sign convention: + = inflow.             |
| Rate     | For \`rate_change\` events.                            |
| Count    | For series events: how many recurrences.               |
| Interval | \`monthly\` / \`weekly\` / \`biweekly\` / \`quarterly\` etc. |

## Master settings

- **Compute method**: Normal (compound, default), USRule (no neg-am), RuleOf78 (front-loaded), Canadian (semi-annual), ExactDays (ACT/365 override).
- **Day-count**: 30/360, ACT/365, ACT/360, ACT/ACT-ISDA, etc.
- **Compounding**: monthly, quarterly, semi-annually, annually, daily, continuous.
- **Payment timing**: annuity-immediate (0) or annuity-due (1).

## Solving for unknowns

Pick **Set unknown** on a cell. The engine solves for that field — payment, principal, rate, term length, or balloon. One unknown at a time; clear all from the toolbar to reset.

## Multi-tab

The toolbar has tab controls. Each tab persists independently to local storage. Use tabs to compare scenarios side by side.

## Undo / redo

\`⌘Z\` / \`⌘⇧Z\` walks the per-tab history stack. Persists across reloads. Setting an unknown is a history step.

## Saving

Save creates a new immutable version under a client + engagement. Old versions stay forever; rollback creates a new version (never overwrites).`,
  },
  {
    id: "calculators",
    title: "Tax calculators",
    category: "user",
    keywords: ["tax", "macrs", "rmd", "roth", "qbi", "amt", "niit", "calculator", "section"],
    body: `Each calculator is a self-contained form-and-narrative tool. Inputs validated by Zod; outputs reproducible against the persisted tax-year tables (rerunning a 2024 calc in 2026 produces the same 2024 result).

## Available

- **MACRS** — half-year, mid-quarter, mid-month conventions; recovery periods 3–39 yrs; bonus depreciation; §179 election.
- **Section 179** — current-year deduction with phase-out and SUV cap.
- **Bonus depreciation** — §168(k) phase-out + OBBBA mid-year override (100% on/after 2025-01-20).
- **RMD** — Uniform Lifetime, Joint Life, Single Life. SECURE 2.0 starting age.
- **Roth conversion** — single-year analysis: marginal tax cost vs. long-run tax-free growth.
- **Federal income tax** — bracket walk for the year, std/itemized, addt'l Medicare, NIIT.
- **QBI (§199A)** — basic + W-2-wage-and-UBIA phase-out, SSTB cliff.
- **AMT (Form 6251)** — exemption with phase-out; preferences & adjustments.
- **NIIT** — 3.8% surtax on net investment income.
- **FICA / Medicare / W-4** — withholding, wage-base cap, addt'l 0.9%.
- **Self-employment tax** — Schedule SE, both halves.
- **Quarterly estimated tax** — safe-harbor, evenly-spaced and annualized.
- **§1031 exchange** — boot, basis transfer, depreciation recapture.
- **IRS interest** — quarterly compounding per §6621.

## TVM templates (workbench)

- Bond price + YTM
- ASC 842 lease PV
- IRR / NPV / MIRR
- Sinking fund
- TDR PV impairment
- §7872 imputed interest (term & demand loans)
- Lease rate factor + implicit rate
- Note buy/sell yield`,
  },
  {
    id: "exports",
    title: "Reports & exports",
    category: "user",
    keywords: ["export", "pdf", "xlsx", "csv", "docx", "zip", "watermark", "draft", "signed"],
    body: `## Formats

- **PDF** — client-deliverable, archival, optionally signed (with approver name + content hash).
- **XLSX** — recipient can edit cells; native formulas where possible.
- **CSV** — RFC-4180 compliant; UTF-8 BOM optional for Excel-Win.
- **DOCX** — memo-style with editable bookmarks.
- **ZIP** — bulk-zip up to 50 calcs; mid-batch failures land in errors.txt.

## Async pipeline

1. Click **Export** on a calc page or in the workbench. The job goes to the queue.
2. **Reports → Exports** polls every 3s while jobs are queued / processing.
3. Done jobs show **Download**. Files retained 30 days; the row stays for audit.

## Watermark

Tick **Mark as DRAFT** before exporting to overlay a diagonal banner. Operators can pass a custom string via the API options.

## Signed PDFs

When a calc is in **approved** status, exporting can sign the PDF: the footer shows \`Approved by Alex Whitmer · sha256:abc123…\`. Recipients verifying integrity recompute the hash over canonical (inputs, outputs).

## Bulk-zip

CalculationsIndex → select rows → **Export to ZIP**. Up to 50 calcs per call. PDF format only.

## Cancel

Queued jobs can be cancelled (BullMQ removal). In-flight renders run to completion.`,
  },
  {
    id: "extraction",
    title: "AI loan-agreement extraction",
    category: "user",
    keywords: ["ai", "extract", "loan", "agreement", "anthropic", "claude", "qwen"],
    body: `## What it does

Paste or upload a loan agreement; the configured LLM extracts a structured JSON payload (borrower, lender, principal, rate, term, payments, balloon, late fee, prepayment penalty, etc.) that seeds a fresh workbench tab.

## What it does NOT do

- Doesn't give legal advice.
- Doesn't warrant interpretation of contract language.
- Doesn't auto-apply to the workbench without your confirmation.

## Walkthrough

1. **Upload** PDF/DOCX (≤10 MB) or **paste** text (≤50,000 chars).
2. Toggle **Redact** if the document has SSNs/EINs/account numbers and you're using cloud AI.
3. **Run extraction** — typically 5–15s for cloud, 30–90s for local.
4. **Review**: fields with confidence < 0.7 show an amber badge. Click any field to highlight its **source quote** in the document pane.
5. **Reconcile**: if the document states an APR/payment, the system independently recomputes and warns on divergence.
6. **Apply to workbench** — fields seed a fresh tab; review flagged confidence issues, then save.

## Privacy

- Cloud calls default to **redaction-on**.
- Local provider runs entirely on the LAN. With \`VIBE_OFFLINE=true\`, only local is selectable.
- Every AI call is logged: prompt hash, response hash, redaction state, provider, model, cost, success/failure.`,
  },
  {
    id: "schedules",
    title: "Scheduled recomputes",
    category: "user",
    keywords: ["schedule", "recurring", "cron", "automation", "tick"],
    body: `A schedule recomputes a saved calculation on a cadence and emails the rendered PDF to a recipient list. Useful for monthly amortization snapshots or quarterly tax-projection refreshes.

## Cadences

\`daily\` / \`weekly\` / \`monthly\` / \`quarterly\` / \`annually\` / \`once\`.

## Lifecycle

1. Create at **Schedules → New**: pick calc, cadence, recipients, subject template.
2. The scheduler ticks every 5 min: walks active schedules whose \`next_run_at\` has passed, runs them in batches, advances \`next_run_at\`.
3. Each run snapshots the calc's current version + outputs into a \`schedule_instances\` row, renders the PDF, emails it.
4. **Pause / resume** toggles the \`status\` field. Paused schedules don't fire.

## Manual tick

Admins can force a tick from the Schedules page or via \`just tick\`. Same code path as the BullMQ worker; safe to fire concurrently (\`SELECT FOR UPDATE SKIP LOCKED\` claim ensures one path sees each row).

## Limits

- Max 50 recipients per schedule (comma-separated).
- Tick resolution = 5 minutes; sub-5-min precision on \`send_at\` is approximate.`,
  },
  {
    id: "profile",
    title: "Profile, 2FA, and sessions",
    category: "user",
    keywords: ["profile", "2fa", "totp", "password", "recovery", "sessions"],
    body: `Find at \`/me\`.

## Password

≥ 12 chars, common-list words rejected, last 5 not reusable. Admins can issue a reset email; your existing password keeps working until you redeem the link.

## Set up 2FA

1. **Set up 2FA** → scan QR with Google Authenticator / 1Password / Bitwarden.
2. Enter the 6-digit code to confirm.
3. **Save the recovery codes** — Download .txt, Copy all, or Print. They're shown once.

### Lost your phone?

Use any printed recovery code in place of the TOTP code on sign-in. Each works once.

### Lost the recovery codes too?

An admin resets your 2FA: **Admin → Users → Reset 2FA**. You re-enroll on next sign-in.

## Sessions

The Sessions card lists every signed-in browser/device. **Revoke** anything you don't recognize. Your current session is marked "this session" — sign out from the user menu in the topbar to revoke it.`,
  },
  {
    id: "admin-users",
    title: "Admin: Users & permissions",
    category: "admin",
    keywords: ["users", "invite", "role", "permission", "admin"],
    body: `## Roles

- **readonly** — read everything, download exports.
- **preparer** — readonly + create/update calcs, run AI extraction, submit for review.
- **reviewer** — preparer + approve/reject, reassign engagements.
- **admin** — all of the above + user mgmt, firm settings, AI provider, audit, backup, tax overrides.

## Invite

**Admin → Users → Invite**. Email + name + role. The system sends a magic-link invitation valid 24h. If the email provider isn't configured, the URL is in the API logs.

## Suspend / unsuspend

Suspend invalidates every active session. Unsuspend restores access. Audit row records the admin who acted.

## Reset password / 2FA

- **Reset password** sends a one-time email valid 1h; existing password keeps working until redeemed.
- **Reset 2FA** wipes the user's TOTP secret + recovery codes; revokes their sessions; they must re-enroll.

Both actions require typed confirmation in the dialog.

## Force 2FA enrollment

The "Require 2FA" admin action forces every user to enroll on next sign-in.`,
  },
  {
    id: "admin-firm",
    title: "Admin: Firm settings & branding",
    category: "admin",
    keywords: ["firm", "logo", "brand", "color", "footer", "ein", "settings"],
    body: `Set the firm-wide identity that appears in PDFs, emails, and the topbar.

## Editable fields

- **firmName** — topbar, PDF header, email "from" name.
- **firmEin / firmAddress / firmPhone** — PDF memo footers (admin-only).
- **pdfFooter** — full footer string on every PDF.
- **brandColor** — 6-digit hex; topbar accent + email button + PDF strip.
- **logoDataUrl** — PNG/JPEG/WebP only (SVG explicitly rejected); ≤1 MB; magic-byte verified.

## Public branding

\`/api/v1/admin/firm-settings/public\` returns ONLY firmName, brandColor, logoDataUrl. Any authenticated user can read this; EIN/address/phone/footer stay admin-only.

## Editing rules

Edits require \`settings:write\`. Audit row records every change with the field list. Save persists immediately — no draft state.`,
  },
  {
    id: "admin-backups",
    title: "Admin: Backups & restore wizard",
    category: "admin",
    keywords: ["backup", "restore", "snapshot", "encrypted", "wizard"],
    body: `Encrypted snapshots of the appliance state. The restore wizard guides recovery from the UI; the actual destructive replace runs via the host CLI.

## What's in a backup

- \`pgdump.bin.enc\` — Postgres custom-format dump, AES-256-CBC.
- \`pdf-output.tgz.enc\` — export volume tarball, AES-256-CBC.
- \`manifest.json\` — version, createdAt, encrypted: true.

## Create a backup

On the host:
\`\`\`
vibecalc-installer backup
\`\`\`
Encrypted by default; needs \`VIBE_BACKUP_PASSPHRASE\` in \`.env\`. Pass \`--plaintext\` to skip encryption (debugging only).

## Restore wizard

1. **Admin → Backups** lists snapshots from the backups volume.
2. Pick a snapshot, type \`DESTRUCTIVE-REPLACE\`, confirm.
3. The API records a \`backup.restore.requested\` audit row and returns the operator-side command.
4. Run \`vibecalc-installer restore /data/backups/<ts> --i-know\` on the host.
5. Sign back in (sessions were wiped).

## Why split UI + CLI?

The API container runs read-only and can't run \`pg_restore\` directly — that would violate the appliance's hardening. The split design ties the UI confirmation (audit row) to the eventual filesystem-level operation.`,
  },
  {
    id: "admin-ai",
    title: "Admin: AI provider, prompts, usage",
    category: "admin",
    keywords: ["ai", "anthropic", "qwen", "llm", "prompt", "cost", "usage"],
    body: `## Provider selection

- \`VIBE_OFFLINE=true\` — local only.
- \`VIBE_LLM_PROVIDER=anthropic\` (explicit) — Anthropic.
- \`VIBE_LLM_PROVIDER=local\` (explicit) — Local.
- Else: prefer Anthropic when \`ANTHROPIC_API_KEY\` is set, fall back to Local when \`VIBE_LLM_LOCAL_URL\` is set.

To rotate, edit \`.env\` and restart the API container.

## Test prompt

**Admin → AI → Send test prompt** fires a small request to verify credentials + reachability.

## Cost ledger

**Admin → AI → Usage** — rolling 30-day token totals + per-user / per-day breakdowns. Override default rate sheet via \`VIBE_LLM_PRICE_INPUT_PER_M\` / \`_OUTPUT_PER_M\`.

## Prompt versioning

**Admin → AI prompts** — author new versions, A/B test by activating two simultaneously, rollback by activating any prior version. Each extraction tags itself with the prompt version used.`,
  },
  {
    id: "admin-tax-tables",
    title: "Admin: Tax tables",
    category: "admin",
    keywords: ["tax", "tables", "irs", "rev", "proc", "brackets", "limits"],
    body: `Read-only browse of seeded IRS rate tables. Tax years 2023, 2024, 2025 are seeded; 2026 figures land when Rev. Proc. 2025-32 publishes.

## Browse

Pick a year, optionally filter by kind. Each card shows the JSON payload + source URL. Mid-year overrides (e.g. OBBBA bonus depreciation) appear in a separate Overrides card.

## Mid-year overrides

The \`tax_year_overrides\` table carries corrections that supersede seeded values for events on/after a specific date. The resolver consults overrides first.

Authoring an override is currently SQL only:
\`\`\`sql
INSERT INTO tax_year_overrides (tax_year, kind, effective_from, payload, ...) VALUES (...);
\`\`\`

## Adding a new tax year

Edit \`packages/db/src/seed-tax-tables.ts\`, append rows for the new year, rebuild + restart, run \`just seed-tax-tables\` (idempotent — skips existing).`,
  },
  {
    id: "admin-audit",
    title: "Admin: Audit log",
    category: "admin",
    keywords: ["audit", "tamper", "chain", "hash", "log"],
    body: `Tamper-evident ledger of every state-changing action.

## How the chain works

\`\`\`
row_hash = sha256(prev_hash || "|" || canonical(record))
\`\`\`

Each row's \`prev_hash\` = prior row's \`row_hash\`. Edit any row → every subsequent row's \`prev_hash\` no longer matches. The chain breaks visibly at the tampered row.

## Validate

Click **Validate chain** at the top. Green checkmark = intact. Red banner = first divergent row identified.

## What gets logged

calc.create / save / submit_for_review / approve / reject / rollback / archive / restore / lock / comment; engagement.transition / assign / archive; client.update / archive; tag.attach / detach; bulk.archive / reassign / change_tax_year; export.created / downloaded; backup.created / restore.requested.

## Retention

Insert-only. No delete from UI, no edit ever. ~1 KB / row; 50 MB/yr at 1000 days × 50 actions/day.`,
  },
  {
    id: "operator-install",
    title: "Operator: Install & upgrade",
    category: "operator",
    keywords: ["install", "upgrade", "setup", "docker"],
    body: `## First-run install

\`\`\`
git clone https://github.com/your-firm/vibe-calculators.git
cd vibe-calculators
./bin/vibecalc-installer.mjs install
\`\`\`

The installer prompts for firm info + admin email + deploy mode, then generates secrets, pulls images, runs migrations, prints the bootstrap URL.

## Upgrade

\`\`\`
./bin/vibecalc-installer.mjs upgrade
\`\`\`

Takes a pre-upgrade backup, pulls newer images, runs pending migrations, restarts. If anything goes wrong:
\`\`\`
./bin/vibecalc-installer.mjs restore ./backups/<pre-upgrade-ts> --i-know
\`\`\`

## Health

\`\`\`
./bin/vibecalc-installer.mjs status   # docker compose ps + /api/health
./bin/vibecalc-installer.mjs doctor   # deep DB/Redis/migration probe
\`\`\`

The doctor exits non-zero if any probe fails — wire it into your monitoring.`,
  },
  {
    id: "operator-deploy",
    title: "Operator: Deploy modes",
    category: "operator",
    keywords: ["deploy", "domain", "tailscale", "lan", "tls"],
    body: `Three modes selected by \`VIBE_DEPLOY_MODE\`:

## lan (default)

Plain HTTP on the firm's LAN. \`VIBE_HTTP_PORT=80\` (or override). **Caveat**: cookies aren't \`Secure\` (no TLS); recovery codes visible to packet capture on the LAN segment. Don't use over untrusted networks.

## domain

Real DNS name with auto-HTTPS via Caddy + Let's Encrypt:
\`\`\`
VIBE_DEPLOY_MODE=domain
VIBE_DOMAIN=vibecalc.firm.example
VIBE_TLS_EMAIL=admin@firm.example
\`\`\`
Pre-flight: A record points at host's public IP; port 80 reachable from the public internet (ACME HTTP-01 challenge); ACME contact email is real. Cert renewal automatic.

## tailscale

Tailscale-only access:
\`\`\`
VIBE_DEPLOY_MODE=tailscale
VIBE_TS_PORT=8000
\`\`\`
On the host: \`tailscale up && tailscale serve --bg --tcp 443 localhost:8000\`. Tailnet members reach via \`https://vibecalc.your-tailnet.ts.net\`.

## Switching

\`\`\`
./bin/vibecalc-installer.mjs mode <lan|domain|tailscale>
docker compose up -d
\`\`\``,
  },
  {
    id: "operator-troubleshooting",
    title: "Operator: Troubleshooting",
    category: "operator",
    keywords: ["error", "broken", "fix", "log", "health", "debug"],
    body: `## Quick checks

\`\`\`
./bin/vibecalc-installer.mjs status     # are containers up?
./bin/vibecalc-installer.mjs doctor     # deep probe
docker compose logs -f vibe-calculators-server | tail -100
\`\`\`

## Setup wizard redirects to /login

A user already exists. Log in with the existing admin or restore from backup.

## Setup completes but lands on /health

Stale React Query cache. Hard-reload (Cmd-Shift-R). Fixed in the current SetupWizard.

## Magic-link emails not arriving

1. Check provider configured: \`docker compose logs vibe-calculators-server | grep "email provider"\`.
2. If "not configured", the URL is in API logs — copy and send.
3. Test SMTP host reachability from inside the container.

## Slow exports

PDF rendering is CPU-bound. Default concurrency=1 — bumping it can cause healthcheck failures. Monitor \`docker stats\` during renders.

## Webhook deliveries failing

**Admin → Webhooks → Deliveries** shows attempt history. Common: DNS rebinding guard (private/loopback IP), expired HTTPS cert, HMAC mismatch.

## Migration fails

\`\`\`
docker compose exec postgres psql -U vibecalculators -d vibe_calculators_db \\
  -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;"
\`\`\`
If the failed migration is missing from the table but present in the schema, manually insert the row, then re-run \`just migrate\`.

## Wipe and reinstall (last resort, DESTRUCTIVE)

\`\`\`
./bin/vibecalc-installer.mjs uninstall --purge --i-know
rm -f .env
./bin/vibecalc-installer.mjs install
\`\`\``,
  },
  {
    id: "operator-backup",
    title: "Operator: Backup & restore (host-side)",
    category: "operator",
    keywords: ["backup", "restore", "rsync", "s3", "off-site"],
    body: `## Daily cron

\`\`\`
0 2 * * * cd /opt/vibe-calculators && \\
  ./bin/vibecalc-installer.mjs backup >> /var/log/vibe-backup.log 2>&1
\`\`\`

Encrypted by default. Requires \`VIBE_BACKUP_PASSPHRASE\` in \`.env\`.

## Off-site replication

\`\`\`
0 3 * * * rsync -av --remove-source-files /opt/vibe-calculators/backups/ \\
  user@offsite:/srv/vibe-backups/firm/
\`\`\`
Encryption is end-to-end so any S3 / SFTP / B2 target sees only ciphertext.

## Restore

\`\`\`
./bin/vibecalc-installer.mjs restore /opt/vibe-calculators/backups/<ts> --i-know
\`\`\`
Auto-detects encrypted (.enc) vs plaintext snapshots. Sessions are dropped; sign back in with prior credentials.

## DR drill (quarterly)

Stand up a fresh appliance on a test box, copy the most recent backup, restore, verify a sampled calc reproduces. If sign-in or calc reproduction fails, escalate.

## What's NOT backed up

- \`.env\` — encrypt and store off-site separately.
- Caddy TLS state — rebuilds on first request.
- Redis BullMQ queues — ephemeral; durable status in Postgres survives.`,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    category: "reference",
    keywords: ["shortcut", "keyboard", "hotkey", "cmd", "ctrl"],
    body: `## Global

| Keys              | Action                    |
| ----------------- | ------------------------- |
| \`⌘K\` / \`Ctrl-K\`  | Command palette           |
| \`?\`               | Page help                 |
| \`g c\`             | Go to Calculators         |
| \`g s\`             | Go to Saved calcs         |
| \`g q\`             | Go to My queue            |
| \`g x\`             | Go to Exports             |

## Workbench

| Keys              | Action                    |
| ----------------- | ------------------------- |
| \`↑\` / \`↓\`        | Move between rows         |
| \`Tab\`             | Move between columns      |
| \`Enter\`           | Edit current cell         |
| \`⌘C\` / \`⌘V\`      | Copy / paste row          |
| \`⌘D\`              | Duplicate row             |
| \`Delete\`          | Remove row                |
| \`⌘Z\` / \`⌘⇧Z\`    | Undo / redo               |
| \`⌘S\`              | Save                      |
| \`⌘E\`              | Export PDF                |
| \`⌘T\` / \`⌘W\`     | New tab / close tab       |
| \`⌘⇧U\`             | Set unknown               |
| \`⌘⇧R\`             | Reset unknowns            |
| \`+1m\`, \`+7d\`, \`+1y\` | Date arithmetic shortcuts |

(\`⌘\` = Cmd on macOS, Ctrl on Windows/Linux.)`,
  },
  {
    id: "glossary",
    title: "Glossary",
    category: "reference",
    keywords: ["glossary", "terms", "definitions", "jargon"],
    body: `## Financial / TVM

- **APR** — Annual Percentage Rate; Reg Z mandatory disclosure.
- **AFR** — Applicable Federal Rate; IRS minimum for related-party loans.
- **Amortization** — Allocating payments between interest + principal.
- **ASC 842** — FASB lease accounting (right-of-use asset capitalization).
- **Balloon** — Large single payment at term end.
- **Day-count** — 30/360, ACT/365, etc. — how year-fractions are computed.
- **Effective rate** — Annualized return after compounding.
- **HELOC** — Home Equity Line of Credit.
- **IRR** — Discount rate that makes NPV = 0.
- **NPV** — Net Present Value (sum of discounted cash flows).
- **OID** — Original Issue Discount.
- **Rule of 78** — Sum-of-digits front-loading.
- **TDR** — Troubled Debt Restructuring (ASC 310-40).
- **TILA** — Truth in Lending Act.
- **USRule** — Simple-interest accrual, no neg-am.
- **YTM** — Yield to Maturity.

## Tax

- **AGI / MAGI** — Adjusted / Modified Adjusted Gross Income.
- **AMT** — Alternative Minimum Tax (Form 6251).
- **FICA** — OASDI 6.2% + Medicare 1.45% + addt'l 0.9%.
- **MACRS** — Modified Accelerated Cost Recovery System; the federal depreciation system.
- **NIIT** — 3.8% Net Investment Income Tax above threshold.
- **QBI** — Qualified Business Income deduction (§199A).
- **RMD** — Required Minimum Distribution (age 73, post-SECURE 2.0).
- **§179** — Current-year deduction election (vs. depreciation).
- **§7872** — Below-market loan rules; imputed interest at AFR.

## Operations

- **BullMQ** — Redis-backed Node.js job queue.
- **Caddy** — Auto-HTTPS reverse proxy serving as the appliance's ingress.
- **distroless** — Minimal container base: just the runtime, no shell.
- **Drizzle** — TypeScript-first ORM.
- **TOTP** — Time-based One-Time Password (RFC 6238).`,
  },
];

/** Search the catalog. Tokenizes query on whitespace; matches title/keywords/body. */
export function searchHelp(query: string): HelpTopic[] {
  const q = query.toLowerCase().trim();
  if (!q) return HELP_TOPICS;
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  return HELP_TOPICS.filter((t) => {
    const blob = (t.title + " " + t.keywords.join(" ") + " " + t.body).toLowerCase();
    return tokens.every((tok) => blob.includes(tok));
  });
}
