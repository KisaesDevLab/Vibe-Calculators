import { addUtcDays, addUtcMonths, addUtcYears } from "@vibe-calc/calc-engine";
import type { ScheduleCadence } from "@vibe-calc/db";

/**
 * Phase 22.1 — cadence → next-run-at.
 *
 * Pure function. The scheduler tick handler reads the matching
 * schedule rows, processes deliveries, then advances next_run_at
 * via this helper.
 *
 * "once" returns null — the schedule is auto-completed after run.
 */
export function nextRunAt(cadence: ScheduleCadence, from: Date): Date | null {
  switch (cadence) {
    case "daily":
      return addUtcDays(from, 1);
    case "weekly":
      return addUtcDays(from, 7);
    case "monthly":
      return addUtcMonths(from, 1);
    case "quarterly":
      return addUtcMonths(from, 3);
    case "annually":
      return addUtcYears(from, 1);
    case "once":
      return null;
  }
}
