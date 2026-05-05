# Reports & exports

Every calculation can be rendered as PDF, XLSX, CSV, or DOCX. Renders
run asynchronously via a BullMQ queue so the UI stays responsive even
on long schedules.

## Available formats

| Format | Use case                                                                        |
| ------ | ------------------------------------------------------------------------------- |
| PDF    | Client-deliverable, archival, signed (with approver name + content hash).       |
| XLSX   | Recipient can edit cells and re-run; uses native Excel formulas where possible. |
| CSV    | Pipeline-friendly export. RFC-4180 compliant; UTF-8 BOM optional for Excel-Win. |
| DOCX   | Memo-style narrative output, edits in Word; bookmarks for tax-memo sections.    |
| ZIP    | Bulk-zip up to 50 calculations as PDFs; mid-batch failures land in errors.txt.  |

## How an export works

1. From a calculation page or the Workbench, click **Export** and
   choose the format.
2. The request lands in the export queue. The page redirects you to
   **Reports → Exports**.
3. The page polls every 3 s while jobs are queued / processing. Once
   `done`, a **Download** button appears.
4. Files are retained for 30 days. The retention sweep runs hourly and
   unlinks expired files; the row stays so you have a permanent
   audit trail of what was exported when.

## Watermarks

Tick **Mark as DRAFT** before exporting to overlay a diagonal "DRAFT —
Not for Distribution" watermark on every page. Operators can also pass
a custom watermark string via the API (see `options.watermark`).

## Signed PDFs

When a calculation is in **approved** status, exporting can sign the
PDF: the footer shows `Approved by Alex Whitmer · sha256:abc123…`.
The hash covers a canonical JSON of (inputs, outputs); recipients
verifying integrity can recompute and compare.

To sign, pass `signed: true` and `approverName: "..."` in the export
options. The CalculationsIndex bulk-export currently leaves signing
off; sign individually from the calc detail page.

## Email delivery

The Workbench's "Email PDF" action skips the queue and uses the
configured email provider (SMTP / Postmark / EmailIt). The body
includes the firm's PDF footer and the sender's display name. There's
a soft cap of 10 MB attachment per recipient.

## Bulk export

Calculations index → select rows → **Export to ZIP**. Up to 50
calculations per call. Each is rendered as a PDF; mid-batch failures
land in `errors.txt` inside the ZIP rather than aborting the whole job.

## Storage layout

```
/data/exports/
  ├─ <user-id>/
  │  ├─ <calc-id>/
  │  │  ├─ 1715600000000-AcmeLLC-12345678-2026-05-12.pdf
  │  │  └─ 1715600100000-AcmeLLC-12345678-2026-05-12.xlsx
  │  └─ <bulk-export-id>/
  │     └─ 1715600200000-calculations-2026-05-12-15.zip
```

Files are owned by the export-job row's `requestedBy` user. Even with
the file path, only the requesting user (or an admin) can download
through the API; direct filesystem access is blocked by the
`read_only: true` container.

## Limits & gotchas

- Schedules > 500 rows render the full table inside the PDF, but the
  XLSX export caps at 1000 rows and emits a "see schedule continues..."
  note for the rest. Use the workbench in-app for unbounded view.
- Currency rendering uses the firm's locale (en-US default). Other
  locales aren't yet wired.
- DOCX output sets bookmarks for editable narrative sections; opening
  in Word lets you tweak commentary without re-running the calc.
- The watermark color is hard-coded `#fee2e2` (light red). Custom
  brand-color watermarks are not yet exposed in the UI.

## Cancelling a queued job

On the Exports page, queued / processing jobs show a **Cancel** button.
Cancellation is best-effort: a queued job is removed from BullMQ
immediately; an in-flight render keeps going to completion (the file
is still produced and delivered, but the row shows `cancelled by user`
in the error message).
