# Deploy modes

The appliance ships with three deployment modes selected by
`VIBE_DEPLOY_MODE`. The Caddyfile branches on this env to set up
the ingress correctly for each.

## `lan` (default)

For a CPA firm running the appliance inside their local network. No
public domain; reachable via the host's LAN IP or a `.local`
mDNS name.

**Setup**

```sh
# .env
VIBE_DEPLOY_MODE=lan
VIBE_HTTP_PORT=80   # or 8080 if 80 is taken
```

Run `vibecalc-installer install`. The appliance binds to port 80 (or
the override) and accepts plain HTTP — no TLS termination.

**Security caveat**: cookies are set without `secure: true` because
plain HTTP is the wire. Recovery codes are visible to anyone on the
LAN segment with packet capture. **Do not** run lan mode over an
untrusted network (rogue Wi-Fi, hub printer, BYOD devices).

For a more secure LAN deploy, run a private CA on your firm network,
issue a cert for `vibecalc.firm.local`, and switch to domain mode
with that cert.

## `domain`

For external access via a real DNS name with auto-HTTPS.

**Setup**

```sh
# .env
VIBE_DEPLOY_MODE=domain
VIBE_DOMAIN=vibecalc.acmecpa.com
VIBE_TLS_EMAIL=admin@acmecpa.com
VIBE_HTTP_PORT=80
VIBE_HTTPS_PORT=443
```

Caddy provisions a Let's Encrypt cert at first-request via HTTP-01
challenge. The HTTP listener auto-redirects to HTTPS. HSTS is
enabled with `max-age=15768000; includeSubDomains; preload`.

**Pre-flight checklist**

- Domain's A record points at the host's public IP.
- Port 80 is reachable from the public internet (the ACME challenge
  needs it).
- ACME contact email is real (Let's Encrypt sends expiry warnings).

**Cert renewal** is automatic — Caddy polls every 12 h and renews
14 days before expiry. Watch logs for `tls.issuance.acme.client.solver:
solving` to confirm.

## `tailscale`

For private-network access via Tailscale. The appliance lives on
your tailnet; only authenticated tailnet members can reach it.

**Setup**

```sh
# .env
VIBE_DEPLOY_MODE=tailscale
VIBE_TS_PORT=8000   # internal listener
```

Then on the host:

```sh
# Install tailscale, sign in
tailscale up
# Expose the appliance on the tailnet
tailscale serve --bg --tcp 443 localhost:8000
```

Caddy listens on `:8000` plaintext; Tailscale's `tailscale serve`
terminates TLS using the magic-DNS-issued tailnet cert and proxies to
Caddy. Tailnet members reach the appliance at
`https://vibecalc.your-tailnet.ts.net`.

**Pre-flight checklist**

- Tailscale ≥ 1.50 with `tailscale serve` support.
- The host has a stable tailnet identity (machine key registered).
- Magic-DNS is enabled in your tailnet ACL.

## Switching modes

```sh
./bin/vibecalc-installer.mjs mode <lan|domain|tailscale>
```

The installer:

1. Updates `VIBE_DEPLOY_MODE` in `.env`.
2. For domain mode, prompts for `VIBE_DOMAIN` + `VIBE_TLS_EMAIL` if
   missing.
3. Tells you to run `docker compose up -d` to apply.

Caddy reloads on the next compose-up; existing certs are preserved.

## Reverse-proxy notes

The Express API trusts exactly **one** proxy hop (the Caddy ingress).
Setting `app.set('trust proxy', 1)` honors `X-Forwarded-For` from one
upstream only — if you put another proxy in front of Caddy (e.g. an
ALB), update this to `2` and document the chain in `.env`. Otherwise
client IPs in audit rows will report the proxy IP, not the user's.

## Behind your firm's egress proxy

If outbound traffic from the appliance goes through a corporate
proxy (e.g. for Anthropic API calls), set:

```sh
HTTP_PROXY=http://proxy.firm.local:3128
HTTPS_PROXY=http://proxy.firm.local:3128
NO_PROXY=localhost,127.0.0.1,postgres,redis,vibe-calculators-server,vibe-calculators-client,caddy
```

Node 20's default fetch honors these env vars.

## Air-gapped (no internet)

```sh
# .env
VIBE_OFFLINE=true
VIBE_LLM_LOCAL_URL=http://vibe-llm:8080/v1   # if running local AI
```

`VIBE_OFFLINE=true`:

- Disables the IRS-AFR auto-update job (run `just sync-afr` manually
  with a downloaded JSON).
- Hides Anthropic from the AI provider selection UI.
- Suppresses telemetry / image-update checks.
- Surfaces an "Offline mode" badge in the topbar.

The appliance fully functions offline; AI extraction works only with a
local provider configured.
