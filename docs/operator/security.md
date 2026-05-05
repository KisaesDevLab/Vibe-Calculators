# Security posture

What the appliance does to defend its data, and what it doesn't.

## Container hardening

- **Distroless runtime**: the API container has no shell, no package
  manager, no curl, no awk. Only the Node binary + the application
  bundle.
- **Read-only root filesystem**: every container mounts `/` read-only.
  Writable areas are explicit tmpfs mounts (`/tmp`, `/run`) and named
  volumes (`/data/exports`, `/data/backups`, `/var/lib/postgresql/data`).
- **`cap_drop: ALL`**: every container drops every Linux capability
  by default. Postgres + Redis re-add only the minimum needed for
  their `gosu`-style privilege drop on entry.
- **`no-new-privileges:true`**: kernel-enforced — a process can't
  acquire new privileges via setuid binaries, even if they exist.
- **`security_opt` AppArmor / SELinux**: not configured by default;
  the deploy host's policy applies.

## Auth posture

- **Password hashing**: argon2id with cost params tuned for ~250 ms
  per hash on commodity hardware (intentionally slow — defeats brute
  force).
- **Session cookies**: HttpOnly, SameSite=Lax, `Secure` in
  domain/tailscale modes. Cookie value is the session ID; the row in
  `sessions` is what's authoritative.
- **TOTP secrets**: AES-GCM-sealed with `VIBE_KMS_KEY` before storage.
  Operator rotation of `VIBE_KMS_KEY` requires re-enrollment of every
  user.
- **Recovery codes**: argon2id-hashed; the plaintext is shown ONCE at
  enrollment time.
- **API keys**: SHA-256 hashed; the plaintext is shown ONCE at
  creation. Constant-time compare on verify.
- **Bootstrap tokens**: argon2id-hashed; single-use, 1 h TTL.
- **Magic links**: token is a URL-safe random 32-byte value.
  Single-use, 15-minute TTL, IP-bound (the consume must come from
  the same IP that requested).
- **Lockout escalation**: 5 failed login attempts in 15 min lock the
  (IP, email) pair for 15 min, escalating to 30 min, 1 h, 4 h, 24 h
  on subsequent re-locks within a 24 h window.

## CSRF defense

- SameSite=Lax cookies block third-party cross-site requests by
  default for any state-changing request.
- All state-changing routes verify the session cookie (or the Bearer
  API key) — there's no implicit-credential flow.
- API key auth requires an explicit Bearer header — no automatic
  inclusion by the browser.

## XSS defense

- React escapes by default; we use `dangerouslySetInnerHTML` exactly
  zero times.
- Email HTML templates use a hand-written `escape()` for every
  user-supplied string. Brand color is injected as CSS only, never as
  a selector.
- Logo uploads are MIME-allowlisted (PNG/JPEG/WebP) with magic-byte
  verification; SVG is rejected to prevent script injection in
  rendered PDFs.
- Helmet middleware on Express: Content-Security-Policy default-src
  'self', X-Content-Type-Options nosniff, X-Frame-Options DENY,
  Referrer-Policy strict-origin-when-cross-origin.

## Injection defense

- Drizzle ORM parameterizes every query; no string-concat SQL
  anywhere.
- Zod parses every HTTP boundary (body, query, params).
- Bearer-token regex enforces the `vibe_<base32>` shape at the auth
  middleware before any DB lookup.

## SSRF defense

- Webhook URL validation at create-time blocks
  private-IP / loopback / metadata-service ranges.
- DNS-rebinding guard at delivery-time re-resolves the hostname and
  rejects if it lands in the same blocklist.
- LocalProvider (AI) URL is screened against
  `169.254.169.254` and `metadata.google.internal` at boot.

## Secrets handling

- **`.env`** is the secrets surface. File mode 0600 set by the
  installer. The container reads it at boot via Docker compose.
- **Logs** redact SSNs, EINs, full names by default (Pino with
  `redact:` config).
- **Audit payloads** can contain free-form JSON; admins are advised
  not to put secrets there.

## What we DO log

- Every authentication attempt (auth_events, hash-chained).
- Every domain-state change (audit_events, hash-chained).
- Every API key authentication.
- Every webhook delivery.
- Every export request + download.

## What we DON'T log

- Passwords (only hashes).
- Recovery codes (only hashes).
- API key plaintext (only hashes).
- TOTP secrets (only sealed ciphertext).
- Magic-link tokens (only hashes after issuance).
- Full document text from AI extractions, except via the audit log
  drill-down (admin only).

## What we DON'T do

- We don't run any client-side code remotely (no auto-update, no
  remote-config, no telemetry beacon).
- We don't make outbound connections except to: configured email
  provider, configured AI provider, IRS-AFR feed, configured
  webhooks (operator-installed).
- We don't store any data outside the appliance's named volumes.
  No usage telemetry, no error reports leave the host.

## Threat model boundary

Out of scope for the appliance's defenses:

- **Compromised host**: a root-on-the-box attacker can read every
  named volume, the `.env`, and tail the logs. Use full-disk
  encryption + LUKS-with-Keyfile if this matters.
- **Compromised admin account**: an admin can read every calculation,
  every audit event, every backup, and configure outbound webhooks
  to exfiltrate. Multi-admin firms should require quorum review for
  destructive ops (not yet implemented).
- **Side-channel attacks** (timing, cache, RAM): `argon2id` slows
  brute-force but doesn't defend against a coresident attacker on
  the same host.

## Periodic security tasks

- **Quarterly**: rotate `VIBE_KMS_KEY` (re-enroll all 2FA
  authenticators).
- **Annually**: rotate `VIBE_BACKUP_PASSPHRASE` (run a fresh backup,
  retire old snapshots).
- **Annually**: review every API key, revoke unused ones.
- **Annually**: review webhook subscriptions, confirm receivers are
  still valid.
- **At every staff offboarding**: suspend the user, rotate any API
  keys they created, revoke their sessions.
- **At every audit-chain validation failure**: investigate before any
  further writes.
