import type Decimal from "decimal.js";
import type { Money, Rate } from "./types.js";
import type { CompoundingInterval } from "./compounding.js";
import type { DayCountConvention } from "./day-count.js";

/**
 * Phase 7.1 — CashFlowEvent schema.
 *
 * The user-editable grid in the workbench (Phase 11) is a list of
 * these. The engine sorts them by date, walks them in order, and
 * accrues interest between adjacent events under the active rate
 * and compounding interval.
 *
 * This file defines the schema; the schedule-generator in
 * cashflow-schedule.ts consumes it.
 */

export type CashFlowEventKind =
  // Cash-flow primitives
  | "loan" // initial principal received
  | "payment" // payment applied
  | "deposit" // deposit increases balance
  | "withdrawal" // withdrawal decreases balance
  | "balloon" // single large payment at term end
  | "prepayment" // ad-hoc principal-only payment
  | "memo" // free-text annotation, no balance effect
  // Rate / convention overrides
  | "rate_change" // new nominal rate effective from this date
  // Series patterns (each expands into a sequence of atomic events)
  | "stepped_amount" // amount steps by fixed dollar each N periods
  | "stepped_percentage" // amount steps by fixed % each N periods
  | "interest_only" // payments cover only accrued interest
  | "fixed_principal" // payment = fixed principal + accrued interest
  | "skip_pattern" // N pay then M skip, repeating
  | "calendar_month_skip" // pay only in selected calendar months
  | "principal_applied_first" // unusual ordering — requires US Rule
  | "existing_note_valuation"; // valuation at a yield != stated rate

/**
 * Series-options carried on the events that need them. Each is a
 * structured detail block keyed by the discriminating event kind.
 */
export interface SeriesOptions {
  /** stepped_amount only. */
  stepAmount?: Money;
  /** stepped_percentage only. */
  stepPercent?: Rate;
  /** stepped_amount / stepped_percentage: how many periods between steps. */
  stepEvery?: number;
  /** skip_pattern only — N consecutive payments then M skips. */
  skipNPayMSkip?: { pay: number; skip: number };
  /** calendar_month_skip only — months 1..12 (skip these months). */
  skipMonths?: number[];
  /** existing_note_valuation only — yield rate (overrides the master rate just for this series). */
  yieldRate?: Rate;
  /** principal_applied_first marker — requires US Rule compute method. */
  requiresUsRule?: boolean;
}

export interface CashFlowEvent {
  /** Wall-clock date (UTC). */
  date: Date;
  kind: CashFlowEventKind;
  /** Money amount; meaning depends on kind. */
  amount?: Money;
  /** Rate value; required for rate_change. */
  rate?: Rate;
  /**
   * Recurring count. For atomic events, count=1 (or omitted). For
   * series events (stepped_*, skip_*, etc.) count = total number of
   * sub-events the series expands into.
   */
  count?: number;
  /** Interval between recurring entries. Default = master compounding. */
  interval?: CompoundingInterval;
  /** Per-event compounding override (Phase 7.13 — extensions). */
  compoundingOverride?: CompoundingInterval;
  /** Free-text memo carried through to the rendered schedule. */
  memo?: string;
  /** Structured options for series events. */
  seriesOptions?: SeriesOptions;
}

/**
 * Master settings that apply to the whole calculation. Per-event
 * overrides take precedence where supported.
 */
export interface MasterCalculationSettings {
  /** The master interest rate (nominal annual). */
  rate: Rate;
  /** The master compounding interval. */
  compounding: CompoundingInterval;
  /** Day-count convention used to compute fractional-period interest. */
  dayCount: DayCountConvention;
  /** ordinary annuity (0) or annuity due (1). */
  paymentTiming: 0 | 1;
  /** Computation method (Normal in core; others in extensions). */
  computeMethod: ComputeMethod;
}

export type ComputeMethod =
  | "Normal" // compound interest, standard waterfall (interest-then-principal)
  | "USRule" // simple interest, no negative amortization
  | "RuleOf78" // sum-of-digits front-loading
  | "Canadian" // semi-annual compounding on monthly payments
  | "ExactDays"; // actual-day exact-interest accrual

// ---------------------------------------------------------------------
// Validators (Phase 7.12)
// ---------------------------------------------------------------------

export interface ValidationIssue {
  index: number;
  kind: CashFlowEventKind;
  field: string;
  message: string;
}

/**
 * Validate every event against the rules the build plan §7.12 calls
 * out. Returns the list of issues; empty list = valid.
 */
export function validateEvents(
  events: CashFlowEvent[],
  master: MasterCalculationSettings,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    switch (e.kind) {
      case "rate_change":
        if (!e.rate) {
          issues.push({ index: i, kind: e.kind, field: "rate", message: "rate is required" });
        }
        break;
      case "stepped_amount":
        if (!e.seriesOptions?.stepAmount || e.seriesOptions.stepAmount.eq(0)) {
          issues.push({
            index: i,
            kind: e.kind,
            field: "seriesOptions.stepAmount",
            message: "stepped_amount requires a non-zero stepAmount",
          });
        }
        break;
      case "stepped_percentage":
        if (!e.seriesOptions?.stepPercent || (e.seriesOptions.stepPercent as Decimal).eq(0)) {
          issues.push({
            index: i,
            kind: e.kind,
            field: "seriesOptions.stepPercent",
            message: "stepped_percentage requires a non-zero stepPercent",
          });
        }
        break;
      case "calendar_month_skip":
        if (!e.seriesOptions?.skipMonths || e.seriesOptions.skipMonths.length === 0) {
          issues.push({
            index: i,
            kind: e.kind,
            field: "seriesOptions.skipMonths",
            message: "calendar_month_skip requires at least one skip month",
          });
        } else {
          for (const m of e.seriesOptions.skipMonths) {
            if (!Number.isInteger(m) || m < 1 || m > 12) {
              issues.push({
                index: i,
                kind: e.kind,
                field: "seriesOptions.skipMonths",
                message: `month ${m} is out of range; must be 1..12`,
              });
            }
          }
          const seen = new Set<number>();
          for (const m of e.seriesOptions.skipMonths) {
            if (seen.has(m)) {
              issues.push({
                index: i,
                kind: e.kind,
                field: "seriesOptions.skipMonths",
                message: `duplicate month ${m}`,
              });
            }
            seen.add(m);
          }
        }
        break;
      case "principal_applied_first":
        if (master.computeMethod !== "USRule") {
          issues.push({
            index: i,
            kind: e.kind,
            field: "master.computeMethod",
            message:
              "principal_applied_first requires the US Rule compute method (Phase 7 extensions)",
          });
        }
        break;
      case "existing_note_valuation":
        if (!e.seriesOptions?.yieldRate) {
          issues.push({
            index: i,
            kind: e.kind,
            field: "seriesOptions.yieldRate",
            message: "existing_note_valuation requires a yieldRate distinct from the master rate",
          });
        }
        break;
      default:
        // No specific validation for the other kinds in core.
        break;
    }
  }
  return issues;
}
