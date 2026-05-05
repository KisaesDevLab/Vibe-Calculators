# TVM workbench

The workbench is a spreadsheet-grade time-value-of-money tool. It accepts
arbitrary cash-flow events on any dates, computes the schedule
continuously as you edit, and supports every TValue-equivalent feature
short of the full custom-event-types DSL.

## Grid columns

| Column   | Purpose                                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date     | The event's date. Type `+1m` to advance one month from the row above.                                                                                                                                                                                                |
| Kind     | `loan`, `deposit`, `payment`, `withdrawal`, `balloon`, `prepayment`, `rate_change`, `interest_only`, `fixed_principal`, `stepped_amount`, `stepped_percentage`, `skip_pattern`, `calendar_month_skip`, `memo`, `existing_note_valuation`, `principal_applied_first`. |
| Amount   | Dollar amount. Sign convention: positive = inflow to the schedule. The engine handles `payment` magnitude correctly even if entered positive.                                                                                                                        |
| Rate     | For `rate_change` events: the new rate from this date forward.                                                                                                                                                                                                       |
| Count    | For series events: how many recurrences.                                                                                                                                                                                                                             |
| Interval | For series events: `monthly`, `weekly`, `biweekly`, `quarterly`, `annually`.                                                                                                                                                                                         |
| Memo     | Free-text note attached to the row.                                                                                                                                                                                                                                  |

## Master settings (top strip)

- **Rate** — the active interest rate at row 1. `rate_change` events
  override from their date forward.
- **Compounding** — `monthly`, `quarterly`, `semi-annually`, `annually`,
  `daily`, `continuous`.
- **Day-count** — `30/360`, `30/360-US`, `30/365`, `ACT/365`, `ACT/360`,
  `ACT/ACT-ISDA`.
- **Payment timing** — annuity-immediate (`0`, default) or annuity-due (`1`).
- **Compute method** — `Normal` (compound), `USRule` (simple, no
  neg-am), `RuleOf78` (sum-of-digits front-loading), `Canadian`
  (semi-annual on monthly), `ExactDays` (overrides day-count to ACT/365).

## Solving for unknowns

Click any cell and pick **Set unknown** from the toolbar. The engine then
solves for that field: payment amount, principal, rate, term length, or
balloon. Multiple unknowns are not supported (the system is overdetermined);
clear all unknowns from the toolbar to reset.

Solving constraints:

- The grid must contain enough events to define the rest of the schedule.
- The unknown must be uniquely solvable. E.g. solving for `i` (rate) on
  a non-monotonic cash flow may have multiple roots; the engine bisects
  on (-0.99, 5.0) and returns the first.

## Multi-tab

The toolbar has tab controls (`+ New`, `Close`, drag-to-reorder).
Each tab persists independently to local storage so closing the browser
doesn't lose work. The `vibecalc.workbench.tab.<id>` keys are
per-tab; clearing site data wipes them.

Use tabs to compare scenarios — copy a tab, tweak the rate, see both
schedules side by side without leaving the workbench.

## Undo / redo

`⌘Z` / `⌘⇧Z` (or Ctrl on Windows) walks the per-tab history stack. The
stack persists across reloads. **Set unknown** is itself a history step.

## Period filter

The **Show: All / Year 1 / Year 2 / …** dropdown filters the visible
rows without losing data. Useful for long schedules where only the
current year matters.

## Empty state

A fresh tab shows three quick-start cards: Mortgage, Auto loan,
Construction draw. Clicking one populates the grid with a sensible
template; you tweak the numbers from there.

## Saving

**Save** records the current state as a new version. The first save
prompts for a client + engagement to attach. Subsequent saves bump the
version pointer. **Version history** shows all saves; each can be
restored (creates a new version, never overwrites).

## Sharing

- **Email PDF** — sends the rendered amortization schedule via the
  configured email provider.
- **Export to Reports** — queues a PDF / XLSX / CSV / DOCX render that
  appears under **Exports**.
- **Apply from extraction** — the AI extraction page can hand a parsed
  loan-agreement directly into a fresh workbench tab; review the rows,
  fix any flagged confidence issues, then save.

## Compute methods — when to use each

- **Normal** (default) — compound interest with the master's day-count.
  Use this for any standard mortgage, auto loan, equipment financing.
  Matches TValue's default.
- **USRule** — simple-interest accrual with NO capitalization of unpaid
  interest. Common in older consumer credit and some private notes.
  If a payment doesn't cover the interest, principal stays put — no
  negative amortization.
- **RuleOf78** — sum-of-digits front-loading, used in some short-term
  consumer loans and pre-1992 vehicle financing. Total interest matches
  Normal; the per-period distribution differs.
- **Canadian** — semi-annual compounding on monthly payments. Standard
  for Canadian residential mortgages.
- **ExactDays** — overrides the master day-count to `ACT/365`. Useful
  when the contract specifies "actual days" interest accrual regardless
  of the payment cadence.

## Limits

- Per-row date precision: day. (Sub-day timestamps are stored UTC but
  not editable in the grid.)
- Schedule horizon: no fixed cap. Schedules with > 500 rows render via
  TanStack Virtual so the grid stays responsive.
- Decimal precision: 28 significant digits via `decimal.js`. No
  floating-point error.
