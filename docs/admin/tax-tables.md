# Admin → Tax tables

Browse the IRS rate tables seeded into the appliance. Read-only.

## What's seeded

Tax years **2023, 2024, 2025**. The 2026 figures will land when Rev.
Proc. 2025-32 publishes (typically October 2025) — until then, picking
"2026" in any tax calculator returns a clear "no rate table for 2026"
error rather than wrong numbers.

Each (year, kind) pair has source URL + IRS revenue procedure
reference. Click the **source** link in the UI to see the original
publication.

## Kinds

| Kind                              | What it stores                                       |
| --------------------------------- | ---------------------------------------------------- |
| federal_tax_brackets              | Rate-bracket tables for single / mfj / mfs / hoh.    |
| standard_deduction                | Single / mfj / mfs / hoh / qw figures.               |
| fica_wage_base                    | OASDI rate, wage base, Medicare rate.                |
| medicare_thresholds               | Additional 0.9% Medicare thresholds per filing.      |
| niit_thresholds                   | Net Investment Income Tax thresholds (fixed by IRC). |
| qbi_thresholds                    | §199A taxable-income thresholds + phase-in ranges.   |
| section_179_limits                | §179 deduction cap, phase-out start, SUV cap.        |
| bonus_depreciation_pct            | §168(k) phase-out percentage.                        |
| hsa_contribution_limits           | Self / family / catch-up / HDHP minimums.            |
| retirement_contribution_limits    | 401(k) / IRA / SEP / SIMPLE / DB / catch-ups.        |
| alternative_minimum_tax_exemption | AMT exemption + phase-out start.                     |

## Browsing

1. Pick a year from the dropdown.
2. Optionally filter to a single kind.
3. Each card shows the JSON payload + the source link.
4. Mid-year overrides (e.g. OBBBA bonus depreciation reinstatement)
   appear in a separate "Overrides" card with an amber border.

## Mid-year overrides

The `tax_year_overrides` table carries corrections that supersede the
seeded value for property/events on or after a specific date. Example:

> 2025-01-20: 100% bonus depreciation reinstated for property placed
> in service on/after this date (OBBBA, H.R. 1, 119th Cong.)

The tax-table resolver consults overrides FIRST. If an override
applies, it wins; otherwise the seed value is used.

Authoring an override is a manual SQL operation (admin only):

```sql
INSERT INTO tax_year_overrides
  (tax_year, kind, effective_from, payload, source_url, source_version, note)
VALUES
  (2025, 'bonus_depreciation_pct', '2025-01-20',
   '{"pct": 1.0}'::jsonb,
   'https://www.congress.gov/bill/119th-congress/house-bill/1',
   'OBBBA — H.R. 1, 119th Cong. (2025)',
   '100% bonus reinstated for property placed in service on/after 2025-01-20.');
```

A future admin UI will let you author overrides without SQL; for now,
this is admin-CLI territory.

## Adding a new tax year

When the IRS publishes Rev. Proc. for the next year (typically
October):

1. Edit `packages/db/src/seed-tax-tables.ts`. Append rows for the new
   year, one per kind, with payload + source URL.
2. Run `pnpm --filter @vibe-calc/db build` then
   `vibecalc-installer restart` (or `docker compose restart
vibe-calculators-server`).
3. Run `just seed-tax-tables` (idempotent — skips existing rows).
4. The new year appears in the dropdown.

Do NOT edit existing year rows — that breaks tax-year reproducibility.
For corrections, use the override table.

## What this page does NOT do

- It's not a tax-research tool. It shows what's seeded; consult IRS
  publications for context, exceptions, special cases.
- It's not editable. Edits go through the seed file (review-friendly,
  in source control) or the override table (admin-CLI for legitimate
  mid-year corrections).
- It doesn't surface the AFR feed (`afr_short_mid_long`); see
  **Admin → AFR feed** for that (Phase 22.2).
