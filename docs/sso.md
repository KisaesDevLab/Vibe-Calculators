# Single sign-on (Vibe Auth) — operator notes

Vibe Calculators signs staff in through `@kisaesdevlab/vibe-auth`, the shared Vibe identity package:
Authorization Code + PKCE against the firm's identity provider (the Vibe Auth broker / authentik on the
appliance, or any OpenID Connect provider), just-in-time provisioning, IdP group → role sync, back-channel
logout, a Settings → Authentication page and a break-glass local admin. The package owns the OIDC flow; the
product side lives in `apps/api/src/lib/vibeAuth.ts` (engine, session adapter, `/auth/*` middleware) and
`apps/api/src/lib/vibeAuthUsers.ts` (user adapter over `users`, audit sink), shared with the break-glass CLI
adapter `apps/api/src/vibeAuthAdapter.ts`.

SSO is additive. The mode defaults to `local`, where nothing changes. **Three principals, one rule:** API
keys (`Authorization: Bearer vibe_…`) and magic links are untouched; only the cookie session is SSO-aware.

**Session model.** An SSO sign-in mints the same server-side `vibecalc_sid` session a password login does
(30-day rolling / 90-day absolute, `Secure` only when `VIBE_DEPLOY_MODE=domain`). The identity behind it
(issuer, subject, IdP session id, KMS-sealed ID token) sits in four nullable `oidc_*` columns on `sessions`
(migration `0022_vibe_auth`), so RP-initiated and back-channel logout can find it. `GET /api/v1/auth/me`
reports `session.sso`.

## Environment

Set by the appliance console at registration (never by hand on an appliance), or by the operator on a
standalone install. Values saved on Settings → Authentication (`auth_settings`) override the environment.

| Variable                                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIBE_AUTH_MODE`                                  | `local` (default) — password / magic link only; `both` — SSO button plus local login; `oidc_only` — SSO only. Changed from Settings → Authentication or the console Identity panel; registration never sets it.                                                                                                                                                                               |
| `VIBE_OIDC_ISSUER`                                | The provider's issuer URL (discovery at `<issuer>/.well-known/openid-configuration`).                                                                                                                                                                                                                                                                                                         |
| `VIBE_OIDC_CLIENT_ID` / `VIBE_OIDC_CLIENT_SECRET` | The registered client. A secret saved through Settings is stored encrypted with `VIBE_KMS_KEY`.                                                                                                                                                                                                                                                                                               |
| `VIBE_OIDC_PUBLIC_URL`                            | This app's public URL **including its prefix** (`http://192.168.1.10/calc` on a LAN appliance, scheme as rendered — never a hard-coded `https`). The redirect URI is `<public URL>/auth/oidc/callback`, the back-channel logout URI `<public URL>/auth/oidc/backchannel`. The path part is also the prefix the API puts back on every path it hands the browser. Changing it needs a restart. |
| `VIBE_OIDC_INTERNAL_BASE`                         | Optional container-to-container base for discovery/token calls when the public issuer is not reachable from inside the network.                                                                                                                                                                                                                                                               |
| `VIBE_OIDC_ROLE_MAP`                              | JSON, IdP group → role. Default: `vibe-admin`, `vibe-it`, `vibe-partner` → `admin`; `vibe-manager` → `reviewer`; `vibe-staff` → `preparer`. Nothing maps to `readonly` by default.                                                                                                                                                                                                            |
| `VIBE_OIDC_DEFAULT_ROLE`                          | Role for a provisioned user matching no group. Unset = such a user is refused.                                                                                                                                                                                                                                                                                                                |
| `VIBE_OIDC_ALLOW_JIT`                             | Create unknown users on first sign-in (default on). Off = only existing users (linked by verified email) may sign in.                                                                                                                                                                                                                                                                         |
| `VIBE_OIDC_REQUIRE_MFA_AMR`                       | Refuse an SSO sign-in whose `amr` claim shows no second factor. The appliance manifest sets it `true` (see below).                                                                                                                                                                                                                                                                            |
| `VIBE_OIDC_IDP_NAME`                              | Button label on the login page.                                                                                                                                                                                                                                                                                                                                                               |
| `VIBE_BREAKGLASS_USERNAME`                        | Default `vibe-breakglass`. `VIBE_BREAKGLASS_PASSWORD` is read only by the CLI when provisioning.                                                                                                                                                                                                                                                                                              |

## Paths and proxies

The engine is created with `basePath: ""` and answers `/auth/*` on the API, outside `/api`. Every ingress
strips the SPA prefix before the API sees a request; the React components get the prefix from
`BASE_PATH` (`apps/web/src/lib/base-path.ts`). **The reverse proxy must route `/auth/*` to the API like
`/api/*`** — the root `Caddyfile` and the Vite dev proxy do; on the appliance the manifest's `auth` matcher
does (`.appliance/manifest.json`).

| Route                                                | Purpose                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/status`                                   | Mode, whether SSO is enabled/reachable, the start path. Unauthenticated; the login page reads it.                                                                                                                                                                   |
| `GET /auth/oidc/start[?return_to=]`                  | Begin the PKCE sign-in.                                                                                                                                                                                                                                             |
| `GET /auth/oidc/callback`                            | Provider redirect; sets `vibecalc_sid` and lands on `return_to`.                                                                                                                                                                                                    |
| `GET /auth/oidc/logout[?local=1]`                    | With `local=1` (what the app's Sign out uses) only this app's session ends — the firm's other Vibe apps stay signed in. Without it the browser goes on to the provider's end-session endpoint.                                                                      |
| `POST /auth/oidc/backchannel`                        | Provider back-channel logout (form `logout_token`). Ends every session of that user.                                                                                                                                                                                |
| `GET /auth/me`                                       | The engine's view of the current user and linked identities (cookie session only).                                                                                                                                                                                  |
| `GET/PUT /auth/settings`, `POST /auth/settings/test` | Settings → Authentication API. Authorised by the `settings:write` permission on a **cookie** session — an API key never opens it. Enabling `oidc_only` needs a provisioned break-glass user **and** a successful test connection by the same admin within the hour. |

**CSP.** `helmet()`'s default policy forbids inline script and style, which the package's own HTML pages
(sign-in error, logged out, the test-connection popup's `postMessage`) need. Those responses — and only
those — get a narrower, self-contained policy and drop `Cross-Origin-Opener-Policy` so the popup keeps
`window.opener`. The root `Caddyfile` now sets its CSP only when the upstream sent none (`?Content-Security-Policy`);
two CSP headers would be intersected by the browser and re-break the popup. **An appliance-level Caddy that
adds its own CSP unconditionally has the same effect** — the test-connection popup then reports nothing and
has to be closed by hand; sign-in itself is unaffected.

## Users and roles

- **JIT users** are created `active`, with no password and `must_change_password = false` (the SPA's
  forced-change gate would trap a user who has no password to change).
- **Existing users** are linked on first SSO sign-in by **verified** email. An invited (`pending`) user is
  activated by it, exactly as a first magic-link sign-in would.
- **Role sync** runs on every SSO sign-in and writes the role slug only. It never demotes the last active
  admin (the break-glass row does not count as another admin); the skip is logged.
- Suspended or archived users are refused.
- **Second factor.** SSO sessions do not pass through this app's TOTP step; the identity provider's MFA
  stands in, which is why `VIBE_OIDC_REQUIRE_MFA_AMR=true` is the appliance default. Turning it off on the
  settings page takes a logged acknowledgement.

## Local sign-in under `oidc_only`

| Path                             | `local` / `both`                                | `oidc_only`                                        |
| -------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Password login                   | unchanged                                       | **403** `local_login_disabled`, except break-glass |
| Magic link (request and consume) | unchanged — including for SSO-provisioned users | **403** for everyone                               |
| API keys                         | unchanged                                       | unchanged                                          |

In `both`, a user provisioned by SSO can still request a magic link and get a local session from their
mailbox. That is a deliberate firm decision (2026-09-20) and a deviation from integration rule I7; switch
to `oidc_only` to close it.

The install-time default admin (`admin@local.test`) cannot sign in under `oidc_only`. Make sure a real
admin can sign in through SSO, and that the break-glass password is stored, before switching.

## Break-glass account

`vibe-breakglass` is a local admin, **password only** — no second factor even if TOTP is later enrolled
on the row, because it has to work during an IdP outage with nothing pre-enrolled. It is the one account
that may sign in locally under `oidc_only`, and the server refuses to start in that mode without it. It
signs in at `/login/local` (unlinked) with the username `vibe-breakglass`; the row is stored under
`vibe-breakglass@vibe-calculators.local` (users are keyed by email; that mailbox does not exist).
Provisioning creates it `active` with `must_change_password = false`; rotating the password ends its
sessions. Provisioning and every break-glass sign-in are audited.

The runtime image is distroless — no shell, no `npx` — so the CLI runs by module path from `WORKDIR /app`,
where it finds `package.json` → `vibeAuth.adapter`:

```
docker exec -i vibe-calculators-server \
  /nodejs/bin/node /app/node_modules/@kisaesdevlab/vibe-auth/dist/cli.js breakglass ensure|rotate|status --json

# verify a built image without starting it (needs a reachable DATABASE_URL for anything but the usage text)
docker run --rm --entrypoint /nodejs/bin/node <image> /app/node_modules/@kisaesdevlab/vibe-auth/dist/cli.js breakglass status
```

`ensure` prints the generated password **once**; the appliance console runs the manifest's
`sso.breakglassCommand` at registration and stores it (`sudo vibe credentials`).

## Audit

The package's events (`vibe.auth.login.success`, `.login.failure`, `.user.provisioned`, `.user.linked`,
`.role.changed`, `.logout`, `.mode.changed`, `.breakglass.used`, `.breakglass.rotated`, `.idp.unreachable`,
`.settings.changed`, `.mfa.enforcement.disabled`) are written verbatim as `auth_event_kind` values into the
same tamper-evident `auth_events` hash chain as local logins. A failed audit write is logged and never
fails the sign-in it describes.

## Building

`@kisaesdevlab/vibe-auth` is a private GitHub Packages module (scope mapped in `.npmrc`; no token in the
repo). Developers keep a `read:packages` token in `~/.npmrc`; image builds take it as a BuildKit secret
(`NODE_AUTH_TOKEN=… just up`, or `docker build --secret id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN …`);
Actions uses `GITHUB_TOKEN`, which works once the package grants this repository read access.

## Appliance

After this ships, the host needs the vendored manifest (`Vibe-Appliance/console/manifests/vibe-calculators.json`)
to carry the same `requires` / `auth` matcher / `sso` block — the console reads **that** copy — then
`sudo vibe identity register vibe-calculators`. A rebuilt image alone does not re-register.

## Deviations from the Vibe Auth integration plan

1. Magic links are refused only in `oidc_only`, not per SSO-only account (rule I7) — firm decision above.
2. `pending` users count as active for linking (the plan said status `active` only); see Users and roles.
3. The local-login guard keeps this API's RFC 7807 envelope instead of the package's `guardLocalLogin` JSON.
4. Settings authorisation uses the permission matrix (`settings:write`), not role equality with `admin`.
5. `breakglassCommand` uses the absolute module path, as the migration command already does.
6. The end-to-end check against the fake IdP is a vitest integration suite
   (`apps/api/src/test/sso.integration.test.ts`, real Postgres via testcontainers) rather than a
   stand-alone `test/sso-e2e.mjs`; it runs with the rest of `pnpm test`.
7. The browser-driven `/auth/oidc/*` steps are not separately rate-limited (Trial Balance's are).
