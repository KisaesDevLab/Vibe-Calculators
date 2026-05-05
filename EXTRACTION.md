# AI Loan-Agreement Extraction (Phase 23)

This document explains how the appliance extracts structured loan terms from agreement documents, what the system does **not** do, and the operator-facing language to use with end-clients.

## What it does

The `/extract` page accepts loan-agreement text (paste or PDF/DOCX upload), sends it to a Large Language Model (LLM), and returns a structured object with the headline terms — principal, rate, term, payment frequency, payment amount, prepayment-penalty flag, late-fee notes, variable-rate clauses, and free-form notes the model thought were relevant.

Each field comes back with a **confidence score (0–1)** and the agreement-text excerpt the model used as the source. Fields below the confidence threshold (default `0.7`) are flagged for review. Every extraction lands in status `needs_review` regardless of confidence — a human approves before the data is applied to a calculation.

## What it does **not** do

- **It is not a tax opinion.** The extractor reads contract text; it does not interpret legal effect, opine on enforceability, or characterize the transaction for tax purposes.
- **It does not warrant accuracy.** LLMs hallucinate. Every number must be cross-checked against the source document before use in client deliverables.
- **It does not store the original PDF/DOCX binary.** Only the parsed text + the structured extraction + the LLM provider's response ID are persisted. If you need the original document, retain it through your firm's existing document-management workflow.
- **It does not replace OCR.** Image-based / scanned PDFs without an embedded text layer extract poorly. Run scans through OCR (e.g. Adobe Acrobat or `ocrmypdf`) before upload.

## Provider configuration

Set `ANTHROPIC_API_KEY` in `.env` to enable the cloud LLM. Optional: `VIBE_LLM_DEFAULT_MODEL` (default `claude-sonnet-4-6`). Without a configured provider, `/extract` shows a clear "no LLM provider configured" message and the route returns 503.

Verify the credential at `/admin/ai` — there's a **Send test prompt** button that fires a tiny request and reports round-trip ms + token counts.

To rotate the key: edit `.env`, then restart the server container (`docker compose restart vibe-calculators-server`). Sealing the key in DB and hot-swapping the provider is a follow-up.

### Cost ledger

`/admin/ai` shows a rolling 30-day usage panel: total calls, tokens (in/out), USD cost, and a per-user breakdown. Rates are configurable via env (`VIBE_LLM_PRICE_INPUT_PER_M` / `_OUTPUT_PER_M`); defaults match Claude Sonnet 4.6 published pricing as of 2026-05.

## Privacy + redaction (Phase 23.5)

The `/extract` page exposes a checkbox: **"Scrub SSN / EIN / long-digit account numbers before parsing"** (default ON). When set, the appliance strips the obvious patterns before the document text is shown to you for review or sent to the LLM:

- US Social Security Numbers (SSN): `xxx-xx-xxxx` with optional dashes / spaces
- Employer Identification Numbers (EIN): `xx-xxxxxxx`
- Long digit runs (10–16 digits) — heuristic match for account numbers

**This is best-effort scrubbing, not a compliance guarantee.** Specifically:

- 9-digit strings without delimiters are NOT redacted (too many false positives — ZIP+4, dates, etc.).
- Hand-OCR'd documents with whitespace inside the number (e.g. `123 45 6789`) may slip through.
- Names, addresses, account holder details, and other PII pass through unredacted.

The redacted text is what the LLM sees. The original (un-redacted) text is **not** stored — `extraction_jobs.document_text` records the redacted version.

If your firm's data-minimization policy forbids sending any client PII to a cloud LLM under any circumstance, do **not** rely on this scrub: treat the entire extraction feature as off-limits and use the manual workbench instead.

## Document upload

Accepted MIME types / extensions:

- `application/pdf` / `.pdf` (parsed via `pdf-parse`)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` / `.docx` (parsed via `mammoth`)
- `text/plain` / `.txt` (utf-8)

Size cap: **10 MB**. The buffer never lands on disk; it's parsed in memory and the parsed text is returned to the operator for review (and edit, if scope-trimming) before extraction.

The /upload endpoint normalizes whitespace (collapses 3+ blank lines to 2, strips control characters except CR/LF/TAB) and caps the output at 500 000 characters — enough for an entire commercial loan agreement.

## Audit trail

Every extraction call records an `audit_events` row with:

- the actor user id
- the redaction flag (on/off)
- input + output token counts
- the LLM provider's response id (Anthropic's per-request identifier — useful for upstream support tickets)
- the prompt version (currently hardcoded; Phase 23.17 will store these in DB)

The audit chain is hash-chained (Phase 21.3) so any tampering with the cost / token-count records is detectable.

## What the model is told

The system prompt (in `packages/llm/src/loan-extraction.ts`) is small and instructs the model to:

1. Extract terms from the document below.
2. Use `null` for any field the document doesn't state explicitly.
3. **Do not infer values that aren't in the text** (this is the most important line — keeps hallucination contained to the per-field-confidence signal rather than smuggling fabricated numbers into the structured output).
4. Add a per-field confidence (0–1) only where parsing was difficult.

Tool-use ("emit_structured_response") forces the model to return a single JSON object matching the schema — no free-form prose. Schema mismatches trigger one auto-retry with a corrective system message; the second failure surfaces a structured error to the operator.

## Operator-facing language for end-clients

If you discuss AI extraction with a client, the recommended framing:

> _"We use AI to read the headline terms out of loan agreements faster. Every number is cross-checked against the source document before we use it in your deliverable, and the AI is told not to guess values the document doesn't state. The original document goes to Anthropic, an Anthropic Privacy Policy applies; we do not retain the document binary on the appliance, only the structured extraction. SSN and EIN patterns are scrubbed automatically before the document is sent. If you'd like us to skip AI extraction for this engagement, please let us know — there's no impact on the work product."_

## What's deferred

Per the build plan, items still on the deferred list:

- §23.3 Local Qwen3-8B provider for fully offline operation
- §23.10 Source-highlighted review pane (clicking a field scrolls the doc to the supporting span)
- §23.12 Auto-reconciliation banner (computed-vs-document payment mismatch surfaced inline)
- §23.13 Document-binary retention (currently only parsed text is stored)
- §23.17 Prompt versioning + A/B (currently hardcoded prompt)
- §23.18 15-anonymized-doc regression suite

Each is a follow-up sprint above a working extract → review → apply baseline.
