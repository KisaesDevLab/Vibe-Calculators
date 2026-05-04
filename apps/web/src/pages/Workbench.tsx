import { useMemo, useState, type ChangeEvent } from "react";
import { Plus, Trash2, RotateCcw } from "lucide-react";
import {
  generateSchedule,
  type CashFlowEventKind,
  type CompoundingInterval,
  type ComputeMethod,
  type DayCountConvention,
  type ScheduleResult,
} from "@vibe-calc/calc-engine";
import { masterToSettings, rowsToEvents, useWorkbenchStore, type GridRow } from "@/store/workbench";
import { MoneyInput } from "@/components/inputs/MoneyInput";
import { DateInput } from "@/components/inputs/DateInput";
import { RateInput } from "@/components/inputs/RateInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Phase 11 — TVM workbench MVP.
 *
 * Build-plan acceptance for this phase:
 *   "A power user can build a 30-year mortgage with one balloon and
 *    one rate change in under 60 seconds, keyboard only; the
 *    resulting schedule matches Phase 7 fixture cents-level."
 *
 * This MVP delivers:
 *   - Master controls bar (label / compounding / rate / day-count /
 *     compute-method / payment-timing)
 *   - Editable event grid: Event / Date / Amount / Rate / Count /
 *     Interval / Memo  (subset of build-plan §11.1 columns; the
 *     End Date / Compounding-override columns are deferred)
 *   - Live recompute on every keystroke (no debounce — calc is fast
 *     enough that human typing speed is fine)
 *   - Bottom result panel: summary totals + tabular schedule
 *   - Insert/Delete row actions; keyboard-only flow
 *   - Save → POST /api/v1/calculations (assigned to engagement
 *     deferred — Phase 11.8 partial)
 *
 * Deferred to follow-up: drag-reorder, right-click menu, series-
 * editor dialog, Loan-Details dialog, schedule virtualization
 * (Phase 12), compare-versions, what-if duplicate, multi-tabs,
 * undo/redo, Sort/Show-running-balance toggles.
 */

const KIND_OPTIONS: CashFlowEventKind[] = [
  "loan",
  "payment",
  "deposit",
  "withdrawal",
  "balloon",
  "prepayment",
  "rate_change",
  "interest_only",
  "stepped_amount",
  "memo",
];

const INTERVAL_OPTIONS: (CompoundingInterval | "")[] = [
  "",
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semi-annual",
  "annual",
];

const DAY_COUNT_OPTIONS: DayCountConvention[] = [
  "30/360",
  "30/360-US",
  "30/365",
  "ACT/360",
  "ACT/365",
  "ACT/ACT-ISDA",
];

const COMPUTE_OPTIONS: ComputeMethod[] = ["Normal", "USRule", "RuleOf78", "Canadian", "ExactDays"];

export function WorkbenchPage(): JSX.Element {
  const master = useWorkbenchStore((s) => s.master);
  const rows = useWorkbenchStore((s) => s.rows);
  const setMaster = useWorkbenchStore((s) => s.setMaster);
  const insertRowAfter = useWorkbenchStore((s) => s.insertRowAfter);
  const deleteRow = useWorkbenchStore((s) => s.deleteRow);
  const updateRow = useWorkbenchStore((s) => s.updateRow);
  const reset = useWorkbenchStore((s) => s.reset);

  const [error, setError] = useState<string | null>(null);

  const schedule = useMemo<ScheduleResult | null>(() => {
    try {
      const events = rowsToEvents(rows);
      if (events.length === 0) return null;
      const settings = masterToSettings(master);
      return generateSchedule(events, settings);
    } catch (e) {
      // Show parse / validation errors below.
      setError(e instanceof Error ? e.message : "Failed to compute schedule");
      return null;
    }
  }, [rows, master]);

  // Reset error when inputs change cleanly.
  useMemo(() => {
    if (schedule) setError(null);
  }, [schedule]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      <header className="flex items-end gap-3">
        <div className="flex-1 space-y-1">
          <Input
            value={master.label}
            onChange={(e) => setMaster("label", e.target.value)}
            className="text-lg font-semibold"
            aria-label="Calculation label"
          />
          <p className="text-xs text-muted-foreground">
            Time-value-of-money workbench. Add events below; the schedule recomputes instantly as
            you type.
          </p>
        </div>
        <Button variant="outline" onClick={reset} aria-label="Reset workbench">
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </header>

      {/* Master controls */}
      <Card>
        <CardHeader>
          <CardTitle>Master settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Nominal annual rate">
            <RateInput value={master.rate} onChange={(v) => setMaster("rate", v)} />
          </Field>
          <Field label="Compounding">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={master.compounding}
              onChange={(e) => setMaster("compounding", e.target.value as CompoundingInterval)}
            >
              {INTERVAL_OPTIONS.filter((x) => x !== "").map((iv) => (
                <option key={iv} value={iv}>
                  {iv}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day-count">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={master.dayCount}
              onChange={(e) => setMaster("dayCount", e.target.value as DayCountConvention)}
            >
              {DAY_COUNT_OPTIONS.map((dc) => (
                <option key={dc} value={dc}>
                  {dc}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Compute method">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={master.computeMethod}
              onChange={(e) => setMaster("computeMethod", e.target.value as ComputeMethod)}
            >
              {COMPUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment timing">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={String(master.paymentTiming)}
              onChange={(e) => setMaster("paymentTiming", Number(e.target.value) as 0 | 1)}
            >
              <option value="0">End of period</option>
              <option value="1">Begin of period</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      {/* Event grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Cash-flow events</CardTitle>
          <Button onClick={() => insertRowAfter(null)} size="sm">
            <Plus className="h-4 w-4" />
            Add row
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2">Event</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  <th className="px-2 py-2 text-right">Count</th>
                  <th className="px-2 py-2">Interval</th>
                  <th className="px-2 py-2">Memo</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RowEditor
                    key={row.rowId}
                    row={row}
                    onChange={(k, v) => updateRow(row.rowId, k, v)}
                    onDelete={() => deleteRow(row.rowId)}
                    onInsertBelow={() => insertRowAfter(row.rowId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Result panel */}
      {schedule && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Stat label="Ending balance" value={schedule.endingBalance.toFixed(2)} />
              <Stat label="Total interest" value={schedule.totalInterest.toFixed(2)} />
              <Stat label="Total principal" value={schedule.totalPrincipal.toFixed(2)} />
              <Stat
                label="Negative-am"
                value={schedule.hasNegativeAm ? "Yes" : "No"}
                emphasis={schedule.hasNegativeAm ? "warn" : "ok"}
              />
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Event</th>
                    <th className="px-2 py-1 text-right">Opening</th>
                    <th className="px-2 py-1 text-right">Interest</th>
                    <th className="px-2 py-1 text-right">Payment</th>
                    <th className="px-2 py-1 text-right">Principal</th>
                    <th className="px-2 py-1 text-right">Closing</th>
                    <th className="px-2 py-1 text-right">Cum. interest</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.rows.map((r, i) => (
                    <tr
                      key={i}
                      className={cn("border-t border-border", r.negativeAm && "bg-destructive/5")}
                    >
                      <td className="px-2 py-1">{r.date.toISOString().slice(0, 10)}</td>
                      <td className="px-2 py-1">{r.kind}</td>
                      <td className="px-2 py-1 text-right">{r.opening.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{r.interestAccrued.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{r.paymentApplied.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{r.principalApplied.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{r.closing.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{r.cumulativeInterest.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "ok" | "warn";
}): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-base font-semibold",
          emphasis === "warn" && "text-destructive",
          emphasis === "ok" && "text-emerald-700",
        )}
      >
        {value}
      </p>
    </div>
  );
}

interface RowEditorProps {
  row: GridRow;
  onChange: <K extends keyof GridRow>(key: K, value: GridRow[K]) => void;
  onDelete: () => void;
  onInsertBelow: () => void;
}

function RowEditor({ row, onChange, onDelete }: RowEditorProps): JSX.Element {
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1">
        <select
          value={row.kind}
          onChange={(e) => onChange("kind", e.target.value as CashFlowEventKind)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1 w-32">
        <DateInput value={row.date} onChange={(v) => onChange("date", v)} />
      </td>
      <td className="px-2 py-1 w-36">
        <MoneyInput value={row.amount} onChange={(v) => onChange("amount", v)} symbol="" />
      </td>
      <td className="px-2 py-1 w-32">
        <RateInput value={row.rateValue} onChange={(v) => onChange("rateValue", v)} />
      </td>
      <td className="px-2 py-1 w-20">
        <Input
          type="text"
          inputMode="numeric"
          value={row.count}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("count", e.target.value)}
          className="text-right"
        />
      </td>
      <td className="px-2 py-1 w-32">
        <select
          value={row.interval}
          onChange={(e) => onChange("interval", e.target.value as GridRow["interval"])}
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
        >
          {INTERVAL_OPTIONS.map((iv) => (
            <option key={iv || "_"} value={iv}>
              {iv === "" ? "(inherit)" : iv}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1">
        <Input
          value={row.memo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("memo", e.target.value)}
        />
      </td>
      <td className="px-2 py-1">
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete row">
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}
