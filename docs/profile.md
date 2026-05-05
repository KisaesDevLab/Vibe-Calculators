# Profile, 2FA, and sessions

Find this page at `/me`.

## Password

- Minimum 12 characters.
- Common-list words rejected (zxcvbn-ts grades on the server).
- Reuse of your previous 5 passwords is blocked.
- An admin can issue a password-reset email; you keep the existing
  password until you redeem the reset link.

## Two-factor authentication (TOTP)

1. Click **Set up 2FA**. The page shows a QR code and the secret string.
2. Scan with Google Authenticator, 1Password, Bitwarden, or any TOTP
   app.
3. Enter the 6-digit code shown by the app to confirm.
4. Save the **recovery codes** that appear next — each works once if
   you lose your authenticator. Use the **Download .txt**, **Copy
   all**, or **Print** buttons. We do not show them again.

### What if I lose my phone?

- Use any of your printed recovery codes in the TOTP field on the
  sign-in page.
- If you've also lost the recovery codes, an admin can reset your 2FA
  from **Admin → Users → Reset 2FA** (which wipes your authenticator
  and forces re-enrollment on next sign-in).

### Resetting 2FA

To switch authenticators, sign in, open `/me`, click **Set up 2FA**
again — the existing one is replaced atomically. You'll get a fresh
recovery code set; the old codes stop working.

## Email digest preference

Under **Preferences**:

- `immediate` — get an email for every comment mention, review request,
  or scheduled-recompute notification as it happens.
- `daily` — one digest at 09:00 firm time.
- `off` — no notification emails.

Magic-link, password-reset, and account-invitation emails always send
regardless of the digest preference (those are auth flow, not
notifications).

## Active sessions

The Sessions card lists every signed-in browser/device, with last-seen
timestamp and IP. **Revoke** any session you don't recognize. Your
current session is marked "this session" and can't be revoked from
itself — sign out instead.

## Sign out

The user menu in the top bar has **Sign out**. It revokes the current
session server-side and clears the cookie.

A logged-out browser still has cached query data (calc lists,
preferences). The user menu's sign-out wipes the React Query cache to
prevent leakage on shared devices.
