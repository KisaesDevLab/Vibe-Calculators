# AI loan-agreement extraction

The `/extract` page parses a loan agreement and produces a structured
JSON payload — borrower, lender, principal, interest rate, term,
payments, balloon, late-fee schedule, prepayment penalty, etc. — that
seeds a fresh workbench tab.

## What the system does

- Accepts pasted text **or** uploaded PDF / DOCX up to 10 MB.
- Optional **redaction** strips SSNs, EINs, and long account numbers
  before the prompt is sent to a cloud LLM.
- Calls the configured **AI provider** (Anthropic API or local
  vibe-llm-server / Qwen3-8B).
- The model emits structured JSON validated against a Zod schema.
- Each field has an optional **confidence score**; anything below 0.7
  is flagged for human review.
- Each field has an optional **source quote** — a verbatim substring
  the model used. The review UI highlights the quote in the document
  pane when you click a field.

## What the system does NOT do

- It does not give legal advice. The agreement still needs
  attorney/CPA review for legal interpretation.
- It does not warrant interpretation of contract language. If the
  document says "interest accrues semi-annually," the model emits that
  fact; it doesn't decide whether that's compatible with the rest of
  the agreement.
- It does not auto-apply to the workbench without your confirmation.
  Every extraction lands in `needs_review` status; an explicit human
  click moves it to `approved`.

## Walkthrough

1. **Upload or paste**. Drag a PDF onto the dropzone or paste up to
   50,000 characters of text. Toggle **Redact** if the document
   contains SSNs / EINs / account numbers and you're using the
   cloud provider.
2. **Run extraction**. The page kicks the LLM and shows a spinner.
   Cloud calls usually return in 5–15 s; local CPU inference can take
   30–90 s.
3. **Review**. The right pane lists extracted fields. Fields with
   confidence < 0.7 show an amber "review" badge. Click any field to
   highlight the source quote in the left pane.
4. **Reconcile**. If the agreement states an APR or monthly payment,
   the system independently recomputes the schedule and warns if the
   numbers diverge beyond Reg Z tolerances.
5. **Apply**. Click **Apply to workbench**. The cash-flow events seed
   a fresh tab; you tweak any flagged fields, then save.

## Privacy

- **Redaction-on** is the default for cloud providers. The redacted
  view is what's sent and what's logged in the audit row.
- **Local provider** runs entirely inside the firm's network. Set
  `VIBE_LLM_LOCAL_URL` to point at your vibe-llm-server. With
  `VIBE_OFFLINE=true`, only the local provider is selectable.
- **Audit trail** — every AI call records prompt hash, response hash,
  redaction state, provider, model, cost, success/failure. Full prompts
  and responses are retained but not surfaced in default UI views.
  Admins can request them from the audit log.

## Cost & limits

- The **Admin → AI provider → Usage** page shows rolling 30-day token
  totals + per-user / per-day breakdowns.
- Per-firm and per-user daily / monthly cost ceilings can be set in
  the AI settings; the UI shows a soft warning at 80%, hard block at
  100%.
- Anthropic Claude Sonnet 4.6 list price is $3 per million input tokens
  / $15 per million output. Override the rate sheet via
  `VIBE_LLM_PRICE_INPUT_PER_M` / `_OUTPUT_PER_M`.

## What gets extracted

```json
{
  "borrower": {"name": "...", "address": "..."},
  "lender":   {"name": "...", "address": "..."},
  "principal": 325000,
  "interestRate": 0.06875,
  "compounding": "monthly",
  "termMonths": 360,
  "firstPaymentDate": "2025-08-01",
  "paymentFrequency": "monthly",
  "paymentAmount": 2135.32,
  "prepaymentPenalty": false,
  "lateFeeNote": "Late charge of 5% applies after 15 days.",
  "variableRateClause": null,
  "notes": null,
  "fieldConfidence": { "paymentAmount": 0.6 },
  "sourceQuotes": { "principal": "Principal: $325,000.00", "..." }
}
```

The full schema is in `packages/llm/src/loan-extraction.ts`.

## Regression suite

A set of 15 anonymized synthetic loan-agreement excerpts ships with
the codebase. CI replays them through a mock provider that returns
the canned `expected` JSON; the extraction pipeline must produce
byte-for-byte parity. This catches schema drift early — if you change
the prompt template and break a field name, all 15 fixtures fail.

The fixtures live at
`packages/llm/src/fixtures/loan-fixtures.ts` and cover mortgages,
commercial term loans, SBA 7(a), construction draws, intra-family
notes, balloons, ARMs, HELOCs, equipment finance, seller carry-backs,
seasonal-skip, and bridge loans.

## Prompt versioning

The active prompt lives in the `ai_prompts` table. Admins can author
new versions at **Admin → AI prompts**, A/B test by setting two as
active, and roll back to any prior version. Each extraction is tagged
with the prompt version that produced it for full reproducibility.
