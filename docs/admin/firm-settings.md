# Admin → Firm settings

The firm-wide identity that appears in PDF headers, email signatures,
and the app's topbar.

## Editable fields

| Field       | Where it shows                                                                   |
| ----------- | -------------------------------------------------------------------------------- |
| firmName    | App topbar; PDF firm header; email "from" name; audit-log actor display.         |
| firmEin     | PDF memo footers; not visible to non-admins.                                     |
| firmAddress | PDF memo footers (3-line address block); ditto, admin-only.                      |
| firmPhone   | PDF memo footers; ditto.                                                         |
| pdfFooter   | The full footer string on every PDF; takes precedence over the address fallback. |
| brandColor  | App topbar accent + email button + brand strip in PDFs.                          |
| logoDataUrl | App topbar logo + email signature image + PDF header.                            |
| timezone    | UI-side rendering of stored UTC timestamps. Defaults to firm-wide UTC.           |

## Logo upload

- **Accepted formats**: PNG, JPEG, WebP only. SVG is explicitly rejected
  to avoid script injection in PDFs and HTML emails.
- **Size cap**: 1 MB raw. The data URL is capped at ~1.4 MB after
  base64 encoding.
- **Magic-byte verification**: the API decodes the base64 payload and
  asserts it starts with the right format header (e.g. PNG starts
  with `89 50 4E 47 0D 0A 1A 0A`). Forged content-type with a
  different payload is rejected.
- **Aspect ratio**: ideal is 1:1 or 4:3. Wider logos render fine in
  PDFs but get squeezed in the topbar's 28×28 box.

## Brand color

- Format: 6-digit hex (`#2563eb`). Validated server-side.
- The color is injected into:
  - Topbar bottom border (via inline style, no CSS leakage)
  - Email button background
  - PDF firm-header strip
- Avoid CSS injection: even though the field is admin-only, the
  injection point uses the value as a CSS property only — never as a
  selector or as inline JavaScript.

## PDF footer template

Free text up to 500 characters. Common patterns:

- `Acme & Associates · 100 Main St, Springfield IL 62701 · (555) 555-1212 · acme.example`
- `Confidential. © 2026 Acme. Computed by Vibe Calculators.`
- `EIN 12-3456789. Distribution prohibited without consent.`

The footer renders below the PDF body and above the "page rendered" date.

## Public branding endpoint

`/api/v1/admin/firm-settings/public` returns ONLY firmName,
brandColor, logoDataUrl. Any authenticated user (not just admin) can
read this endpoint; the AppShell uses it to render the topbar.
EIN, address, phone, and footer stay admin-only.

## Editing rules

Edits require `settings:write` permission (admin only by default).
The audit row records every change with the field list. There's no
"discard draft" — clicking **Save** persists immediately. To revert,
set the fields back to the prior values.

## What this does NOT cover

- **Email signature template**: the rendered HTML is hand-written in
  `packages/email/src/templates.ts`. Customizing the layout requires
  a code change.
- **Per-user logos / signatures**: not supported. The firm has one
  brand identity.
- **Multi-firm tenanting**: this app is single-firm by design. Run a
  second container if you need a separate firm.
