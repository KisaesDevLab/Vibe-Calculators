# Getting started

Your administrator gave you a URL and credentials. This guide walks you
from sign-in to a saved, exported calculation in about ten minutes.

## 1. Sign in

Open the appliance URL. You have three sign-in paths:

- **Email + password** — what you set up in your invitation. If you've
  enabled 2FA, the next screen asks for your authenticator code.
- **Magic link** — click "Send a magic link" on the sign-in screen, then
  open the email. Useful if you've forgotten your password.
- **Single-use recovery code** — if you've lost your authenticator, paste
  any of your printed recovery codes in place of the TOTP code. Each
  recovery code works exactly once.

After sign-in you land on the **Calculators** page. The left rail is your
navigation; the top bar holds search (`⌘K` / `Ctrl-K`) and your user
menu.

## 2. Run your first calculation

The fastest first calculation is a TVM amortization:

1. Click **Calculators** → **TVM workbench**.
2. The first row is your loan event. Set the date, kind (`loan`),
   amount (e.g. `100000`).
3. Add a row for monthly payments: kind = `payment`, amount = `1933.28`,
   count = `60`, interval = `monthly`.
4. The schedule recomputes as you type. The summary cards at the top
   show ending balance, total interest, total principal.
5. Click **Save** to capture this as a calculation. Pick or create a
   client and engagement to attach it to.

For a tax calculation:

1. Click **Calculators** → pick e.g. **MACRS depreciation**.
2. Fill the form (asset cost, in-service date, recovery period, method).
3. Click **Compute**. The result shows the year-by-year schedule plus a
   plain-English narrative.
4. Click **PDF** to render a memo for your file.

## 3. Save & share

Every saved calculation is **versioned**. Edits land as new versions; old
versions are immutable. The version history button shows every prior
state with diffs.

To share a result with a client:

- **PDF / XLSX / DOCX** export — Reports → Exports → pick a format. Done
  jobs are retained for 30 days under your user.
- **Email** — from the Workbench's "Email PDF" action; uses your firm's
  configured SMTP / Postmark / EmailIt provider.
- **Watermark** — toggle "Mark as DRAFT" before exporting to overlay a
  diagonal banner.

## 4. Stay efficient

- `⌘K` opens command palette — type "AMT", "Reg Z", "RMD", any
  calculator name, or any client / engagement name.
- The **My queue** sidebar item lists engagements assigned to you with an
  SLA flag for things sitting longer than 3 days.
- The **Exports** page is your inbox for queued PDF / XLSX renders. They
  take a few seconds in the background and appear here when ready.

## Next steps

- [TVM workbench guide](./workbench.md) — power-user features.
- [Tax calculators index](./calculators.md) — what each one does.
- [Profile & 2FA](./profile.md) — set up authenticator + recovery codes.
