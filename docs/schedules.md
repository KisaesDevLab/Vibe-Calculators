# Scheduled recomputes

A **schedule** runs a saved calculation on a recurring cadence and
emails the rendered PDF to a recipient list. Useful for monthly
amortization snapshots, quarterly tax-projection refreshes, or
year-end reviews.

## Cadences

- `daily` — every 24 h from `next_run_at`
- `weekly` — every 7 days
- `monthly` — same day-of-month next month (with month-end clamping)
- `quarterly` — every 3 months
- `annually` — every 12 months
- `once` — fires once at `next_run_at`, then auto-completes

## Anatomy

| Field            | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `calculation_id` | Which calc to recompute.                                  |
| `cadence`        | One of the values above.                                  |
| `next_run_at`    | UTC timestamp of the next firing.                         |
| `send_at`        | Time-of-day (UTC `HH:MM`); used to compute `next_run_at`. |
| `recipients`     | Comma-separated email list.                               |
| `subject`        | Email subject; supports `{{calc.name}}`, `{{run.date}}`.  |
| `body`           | Optional cover note.                                      |
| `status`         | `active`, `paused`, `completed`, `failed`.                |

## Lifecycle

1. **Create** at `/schedules` → New. Pick a calc, cadence, recipients,
   subject template, time-of-day. The wizard computes
   `next_run_at = tomorrow at send_at`.
2. **Tick** — every 5 minutes the scheduler worker (BullMQ repeatable
   job) walks every active schedule whose `next_run_at` is past, runs
   them in batches of 50, and advances `next_run_at` for the next
   cycle.
3. **Run** — for each due schedule:
   - claim atomically via `SELECT FOR UPDATE SKIP LOCKED` (defends
     against double-fire if an admin manually ticks the same time)
   - snapshot the calc's current version + outputs into a
     `schedule_instances` row
   - render the configured PDF
   - email each recipient
4. **Pause / resume** — admin action on the schedule row toggles
   `status`. Paused schedules don't fire until resumed.
5. **Auto-complete** — `once` cadence completes after the first run.
   Other cadences run forever or until the schedule is archived.

## Manual tick

Admins can force a tick from the Schedules page (`POST /tick`) or via
`just tick`. The manual path runs the same logic as the BullMQ worker
and is safe to fire concurrently — the `FOR UPDATE SKIP LOCKED` claim
ensures only one path sees each row.

## Schedule instances (audit trail)

Every run lands a `schedule_instances` row capturing:

- Calculation version snapshot (inputs + outputs at run time)
- Email delivery status (provider message ID on success, error on
  failure)
- Retry counter

Browse instances on the Schedules detail page; they link back to the
original calculation version.

## Limits

- Maximum recipients per schedule: 50 (comma-separated).
- The PDF render uses the same export pipeline as ad-hoc PDFs (30-day
  retention).
- If the configured email provider is missing or fails, the
  `schedule_instances` row records the failure and the schedule
  continues firing on cadence — there's no exponential back-off on
  failed deliveries.
- The scheduler tick runs at 5-minute resolution; sub-five-minute
  precision on `send_at` is therefore approximate.

## Re-running a past schedule instance

Open the instance detail page → **Re-render**. This produces a fresh
PDF using the snapshotted version (not the current calc state), which
is useful for "send last quarter's report again" requests after the
calc has been edited.
