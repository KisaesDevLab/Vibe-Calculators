# Admin → Users

Manage who can sign in, what role they hold, and how they recover from
common failures.

## Roles

| Role     | What it can do                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| readonly | Read every client / engagement / calculation; download exports. Cannot mutate anything.                                |
| preparer | Everything readonly + create/update calcs, run AI extraction, submit for review.                                       |
| reviewer | Everything preparer + approve / reject calculations, reassign engagements.                                             |
| admin    | Everything plus user management, firm settings, AI provider config, audit log, backup/restore, mid-year tax overrides. |

The role tiers are inclusive: every admin permission includes every
reviewer permission and so on. The full matrix is at
`packages/shared-types/src/permissions.ts`.

## Invite a user

1. Click **Invite user**.
2. Enter email + name + role.
3. The system sends a magic-link invitation valid for 24 h. The user
   clicks the link, sets a password, optionally enrolls 2FA.

If the email provider isn't configured, the magic link is logged to
the API container's stdout — copy the URL from logs and send it
manually.

## Suspend / unsuspend

Click **Suspend** to immediately invalidate every active session for
the user and block future sign-in. The audit row records the admin
who suspended. **Unsuspend** restores access.

A typed-confirmation dialog prevents accidental clicks; suspended
users see a clear "Your account is suspended" message instead of a
silent failure.

## Reset password

Sends a one-time password-reset email valid for 1 h. The user's
existing password keeps working until they redeem the link — there's
no service interruption.

## Reset 2FA

Wipes the user's TOTP secret + recovery codes and revokes their
sessions. They MUST re-enroll on next sign-in. Use this when a user
loses their phone AND their recovery codes.

## Force 2FA enrollment

The "Require 2FA" admin action forces every user to enroll on next
sign-in. Useful firm-wide policy switch — flip it once, every user
sets up an authenticator on their next visit.

## Lockout cleared

If a user gets locked out from too many failed login attempts, the
admin can clear the (IP, email) pair from **Admin → Users → Lockouts**.
The audit row records both the cleared pair and the admin's IP.

## Hard delete

There's no UI for hard-delete. To remove a user permanently (e.g.
GDPR right-to-erasure), use the CLI:

```sh
docker compose exec postgres \
  psql -U vibecalculators -d vibe_calculators_db \
  -c "DELETE FROM users WHERE email = 'gone@firm.test';"
```

The `ON DELETE SET NULL` foreign keys preserve orphaned audit-event
rows so the chain stays intact; the user's name simply becomes
"(deleted)" in past calculations they authored.
