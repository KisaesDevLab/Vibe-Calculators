# Admin → AI provider, prompts, usage

Configure where AI extraction runs and how prompts are managed.

## Provider selection

Two providers are wired:

- **Anthropic API** (Claude Sonnet / Haiku) — cloud, default for
  online deploys.
- **Local** (vibe-llm-server / Qwen3-8B / any OpenAI-compatible
  gateway) — air-gapped, on-LAN inference.

Selection rules (boot-time, from `.env`):

| Condition                                | Active provider        |
| ---------------------------------------- | ---------------------- |
| `VIBE_OFFLINE=true`                      | Local only             |
| `VIBE_LLM_PROVIDER=anthropic` (explicit) | Anthropic              |
| `VIBE_LLM_PROVIDER=local` (explicit)     | Local                  |
| `ANTHROPIC_API_KEY` set                  | Anthropic              |
| `VIBE_LLM_LOCAL_URL` set                 | Local                  |
| Neither configured                       | None — extractions 503 |

To rotate, edit `.env` and restart the API container. Hot-reload of
the AI provider is not yet implemented.

## Anthropic configuration

```sh
# .env
ANTHROPIC_API_KEY=sk-ant-…
VIBE_LLM_DEFAULT_MODEL=claude-sonnet-4-6   # optional override
```

The admin AI page shows the first 4 chars of the key as a "yes, the
right one is loaded" hint. To rotate, replace the value in `.env` and
`docker compose restart vibe-calculators-server`.

## Local provider configuration

```sh
# .env
VIBE_LLM_LOCAL_URL=http://vibe-llm:8080/v1
VIBE_LLM_LOCAL_MODEL=qwen3-8b              # optional
VIBE_LLM_LOCAL_API_KEY=                    # optional, for gated gateways
```

The URL is screened against cloud-metadata blocklists (e.g.
`169.254.169.254`) at boot; URLs to private/loopback hosts are
allowed.

## Test prompt

The Admin → AI page has a "Send test prompt" form. It fires a tiny
prompt at the configured provider with `max_tokens=32, temperature=0`,
reports round-trip latency + tokens used. Use this to confirm
credentials + reachability after a config change.

## Cost ledger

Rolling 30-day usage at **Admin → AI → Usage**:

- Total calls / succeeded / token totals / dollar cost.
- Per-user breakdown sorted by spend.
- Per-day breakdown sorted by date.

Rates default to Claude Sonnet 4.6 list price ($3 / $15 per million in
/ out). Override per the rate sheet you actually pay:

```sh
VIBE_LLM_PRICE_INPUT_PER_M=2.50
VIBE_LLM_PRICE_OUTPUT_PER_M=12.00
```

The local provider always shows $0 cost — the operator is paying
electricity, not per-token.

## Soft + hard caps

(Not yet wired in the UI but the schema supports them.) Per-user and
per-firm daily / monthly cost ceilings will surface a warning at 80%
and hard-block at 100%.

## Prompt versioning

Prompts live in the `ai_prompts` table. Each row has:

- `kind` — `loan-extraction` (currently the only kind)
- `version` — monotonic int per kind
- `body` — the prompt template (supports `{{document}}` placeholder)
- `systemMessage` — the system instruction
- `active` — boolean (one or two can be active for A/B testing)
- `notes` — admin-readable description of the change

### Authoring a new prompt

1. **Admin → AI prompts → New version.**
2. Edit body + system message + notes.
3. Save (status: inactive).
4. Test on the `/extract` page by manually toggling active.
5. Click **Activate** when satisfied; the previous active row is
   automatically deactivated.

### A/B testing

Set two prompts active simultaneously. The extraction route picks one
randomly per request and tags the resulting `extraction_jobs` row
with `prompt_version` so you can compare quality after a few hundred
samples.

### Rollback

Any prior version can be reactivated. Click **Activate** on an
older row.

## Audit & privacy

- Every AI call lands an audit row with: prompt hash (sha256 of the
  rendered text), response hash, redaction flag, provider, model,
  cost, success/failure.
- Full prompt + response are retained but excluded from default UI
  views — admins can request them via the audit detail page.
- Redaction logs the redacted view (the version actually sent to a
  cloud provider), not the raw document.
- Document storage: PDF/DOCX uploads are parsed in memory and never
  hit disk. The extracted text is stored in `extraction_jobs.documentText`
  for replay; the raw document is discarded.
