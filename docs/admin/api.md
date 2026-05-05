# Admin → API keys & webhooks

How the firm's other systems talk to Vibe Calculators.

## API keys (Bearer tokens)

Each key is a per-firm credential that authenticates as a specific
user (its `actAsUserId`). Permissions follow that user's role.

### Issuing a key

1. **Admin → API keys → New key.**
2. Name the key (e.g. "GitHub Actions backup script").
3. Pick the act-as user — usually a service-account user with the
   minimum role needed.
4. Optionally pin an expiry date and scope subset (`calculation:read`
   only, no writes).
5. Click **Create**. The plaintext token shows once; copy it now. The
   server stores only the SHA-256 hash.

Token format: `vibe_<8-char-prefix><32-char-body>`. The prefix is
visible in the admin UI to identify a key without revealing the
secret.

### Using a key

```http
GET /api/v1/calculations
Authorization: Bearer vibe_ABC2DEFG…
```

If the Bearer header is present, the server authenticates ONLY via
the API key — there's no fallback to a cookie session if the key is
invalid.

### Revoking a key

**Admin → API keys → Revoke**. Effective immediately on the next
request. The key row stays for the audit trail.

### Rate limit

Default 60 req/min per key. Override per-key by editing the
`rate_limit_per_min` column (admin SQL or future UI). Responses
include `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
and on 429 a `Retry-After` header in seconds.

### OpenAPI spec

`/api/docs` serves Swagger UI when the appliance isn't in
production-locked mode. The OpenAPI 3.0.3 schema is at
`/api/v1/openapi.json`.

## Webhooks

Outbound notifications when interesting events happen.

### Subscribed events

- `calculation.create` — a new calc is saved.
- `calculation.approve` — a calc is approved by a reviewer.
- `export.completed` — a queued export finished rendering.
- (More events coming; check the audit-action enum in the schema for
  the current full list.)

### Creating a subscription

1. **Admin → Webhooks → New subscription.**
2. Set the URL (must be HTTPS in production; HTTP allowed only for
   private/loopback addresses).
3. Pick events: leave the actions list empty for "all events," or
   select a subset.
4. The system generates an HMAC secret. Copy it now — it's stored
   sealed with the firm's KMS key.
5. **Test fire** sends a sample payload to verify the endpoint accepts
   POST + responds 2xx.

### Verifying a delivery

Each request carries:

```http
POST <your-url>
Content-Type: application/json
X-Vibe-Signature: t=<unix-ts>,v1=<hex-hmac>
X-Vibe-Action: calculation.approve
X-Vibe-Delivery-Id: <uuid>
X-Vibe-Attempt: 1
```

Compute `HMAC-SHA256(secret, "<unix-ts>." + body)` and constant-time
compare to the `v1=` value. Reject deliveries older than 5 minutes
(replay protection). The example verifier is in
`packages/email-events-receiver/...` (or hand-write one — it's 10
lines).

### Retry policy

- Failed delivery is retried with exponential backoff: 5 / 15 / 60 /
  300 / 1800 seconds.
- After 5 consecutive failures the row goes to `dead-letter` status
  and won't retry until you manually redrive it.
- Dead-letter rows are visible at **Admin → Webhooks → Deliveries**.
- DNS rebinding guard: hostnames that resolve to private/loopback IPs
  at delivery time fail-fast (defense against late TTL flip).

### Test webhooks against a local server

```sh
# Start a local listener
ngrok http 8080
# Add a subscription pointing at the ngrok URL
# Trigger an event in the app — the listener gets the POST
```

Or use webhook.site for ad-hoc testing — just paste the URL into the
subscription form.

## Securing both surfaces

- **Audit log** captures every API key authentication and every
  webhook delivery (or attempt).
- API keys can be **scoped** to a permission subset; even if the
  act-as user is admin, a `read-only` scope on the key prevents
  writes.
- Webhook secrets are stored AES-GCM-sealed; rotating
  `VIBE_KMS_KEY` requires re-issuing every secret (the seal is
  envelope-encrypted with the master key).
