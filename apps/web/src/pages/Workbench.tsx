import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Plus,
  Trash2,
  RotateCcw,
  Clipboard,
  Printer,
  ArrowDownAZ,
  HelpCircle,
  Layers,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ScheduleChart, scheduleToTsv, type ChartKind } from "@/components/schedule/ScheduleChart";
import {
  generateSchedule,
  type CashFlowEventKind,
  type CompoundingInterval,
  type ComputeMethod,
  type DayCountConvention,
  type ScheduleResult,
} from "@vibe-calc/calc-engine";
import {
  masterToSettings,
  rowsToEvents,
  useWorkbenchStore,
  type GridRow,
  type LoanDetailsState,
  type MasterUiState,
} from "@/store/workbench";
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
  const sortByDate = useWorkbenchStore((s) => s.sortByDate);
  const loanDetails = useWorkbenchStore((s) => s.loanDetails);
  const setLoanDetail = useWorkbenchStore((s) => s.setLoanDetail);
  const seedFromExtraction = useWorkbenchStore((s) => s.seedFromExtraction);
  const [loanDetailsOpen, setLoanDetailsOpen] = useState(false);
  const [seriesEditorOpen, setSeriesEditorOpen] = useState(false);

  // Phase 23 — pick up a seed left by the /extract page in
  // sessionStorage. Single-shot: consumed once and cleared.
  useEffect(() => {
    const seed = sessionStorage.getItem("vibecalc.workbench.seed");
    if (!seed) return;
    sessionStorage.removeItem("vibecalc.workbench.seed");
    try {
      const parsed = JSON.parse(seed) as Record<string, unknown>;
      seedFromExtraction(parsed);
      toast.success("Workbench seeded from extraction.");
    } catch {
      toast.error("Could not load extracted seed.");
    }
  }, [seedFromExtraction]);

  const [error, setError] = useState<string | null>(null);

  // Compute schedule purely (no side effects). useMemo's contract
  // forbids state mutations during render — moved to useEffect below.
  const schedule = useMemo<{ result: ScheduleResult | null; error: string | null }>(() => {
    try {
      const events = rowsToEvents(rows);
      if (events.length === 0) return { result: null, error: null };
      const settings = masterToSettings(master);
      return { result: generateSchedule(events, settings), error: null };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : "Failed to compute schedule",
      };
    }
  }, [rows, master]);

  // Sync the error state in an effect (the right hook for side effects).
  useEffect(() => {
    setError(schedule.error);
  }, [schedule.error]);

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
        <Button variant="outline" onClick={sortByDate} aria-label="Sort rows by date">
          <ArrowDownAZ className="h-4 w-4" />
          Sort
        </Button>
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

      {/* Loan Details (Phase 11.16) — collapsible metadata block. */}
      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between cursor-pointer"
          onClick={() => setLoanDetailsOpen((o) => !o)}
        >
          <CardTitle className="text-base">Loan details (PDF metadata)</CardTitle>
          <Button variant="ghost" size="sm">
            {loanDetailsOpen ? "Hide" : "Show"}
          </Button>
        </CardHeader>
        {loanDetailsOpen && (
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label="Borrower">
              <Input
                value={loanDetails.borrowerName}
                onChange={(e) => setLoanDetail("borrowerName", e.target.value)}
              />
            </Field>
            <Field label="Lender">
              <Input
                value={loanDetails.lenderName}
                onChange={(e) => setLoanDetail("lenderName", e.target.value)}
              />
            </Field>
            <Field label="Loan type">
              <Input
                value={loanDetails.loanType}
                onChange={(e) => setLoanDetail("loanType", e.target.value)}
              />
            </Field>
            <Field label="Prepared by">
              <Input
                value={loanDetails.preparedBy}
                onChange={(e) => setLoanDetail("preparedBy", e.target.value)}
              />
            </Field>
            <Field label="Prepared on">
              <DateInput
                value={loanDetails.preparedOn}
                onChange={(v) => setLoanDetail("preparedOn", v)}
              />
            </Field>
            <Field label="Original loan date">
              <DateInput
                value={loanDetails.originalLoanDate}
                onChange={(v) => setLoanDetail("originalLoanDate", v)}
              />
            </Field>
            <Field label="Custom 1">
              <Input
                value={loanDetails.custom1}
                onChange={(e) => setLoanDetail("custom1", e.target.value)}
              />
            </Field>
            <Field label="Custom 2">
              <Input
                value={loanDetails.custom2}
                onChange={(e) => setLoanDetail("custom2", e.target.value)}
              />
            </Field>
            <Field label="Custom 3">
              <Input
                value={loanDetails.custom3}
                onChange={(e) => setLoanDetail("custom3", e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2 md:col-span-3">
              <Field label="Notes (PDF appendix)">
                <textarea
                  className="h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  value={loanDetails.notes}
                  onChange={(e) => setLoanDetail("notes", e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Event grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Cash-flow events</CardTitle>
          <div className="flex gap-2">
            <Button onClick={() => setSeriesEditorOpen(true)} size="sm" variant="outline">
              <Layers className="h-4 w-4" />
              Add series
            </Button>
            <Button onClick={() => insertRowAfter(null)} size="sm">
              <Plus className="h-4 w-4" />
              Add row
            </Button>
          </div>
        </CardHeader>
        {seriesEditorOpen && (
          <SeriesEditor
            onCancel={() => setSeriesEditorOpen(false)}
            onInsert={(row) => {
              const newId = insertRowAfter(null);
              for (const [k, v] of Object.entries(row)) {
                updateRow(newId, k as keyof typeof row, v as never);
              }
              setSeriesEditorOpen(false);
              toast.success(`Inserted ${row.kind} series of ${row.count}.`);
            }}
          />
        )}
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
      {schedule.result && (
        <ResultPanel
          schedule={schedule.result}
          master={master}
          label={master.label}
          rows={rows}
          loanDetails={loanDetails}
        />
      )}
    </main>
  );
}

/**
 * Phase 12.7 — "show me the math" derivation for a single schedule row.
 * Plain-English so a CPA can verify the engine's behavior at a glance.
 */
function deriveMathTooltip(
  row: ScheduleResult["rows"][number],
  master: { rate: string; compounding: string; dayCount: string },
): string {
  const lines: string[] = [];
  lines.push(`Date: ${row.date.toISOString().slice(0, 10)}`);
  lines.push(`Event: ${row.kind}`);
  lines.push(`Opening balance: ${row.opening.toFixed(2)}`);
  lines.push(
    `Interest accrued = opening × periodic-rate × days under ${master.dayCount}` +
      ` = ${row.opening.toFixed(2)} × (${master.rate}/${master.compounding}) = ${row.interestAccrued.toFixed(2)}`,
  );
  if (Number(row.paymentApplied.toFixed(2)) !== 0) {
    lines.push(
      `Payment applied: ${row.paymentApplied.toFixed(2)} → interest first ${row.interestAccrued.toFixed(2)}, principal ${row.principalApplied.toFixed(2)}`,
    );
  }
  lines.push(`Closing = opening + interest − principal applied = ${row.closing.toFixed(2)}`);
  if (row.negativeAm) lines.push("⚠ Negative amortization on this row.");
  if (row.memo) lines.push(`Memo: ${row.memo}`);
  return lines.join("\n");
}

function ResultPanel({
  schedule,
  master,
  rows,
  loanDetails,
}: {
  schedule: ScheduleResult;
  master: MasterUiState;
  label: string;
  rows: GridRow[];
  loanDetails: LoanDetailsState;
}): JSX.Element {
  const [chart, setChart] = useState<ChartKind>("stacked");

  async function copyTsv(): Promise<void> {
    try {
      await navigator.clipboard.writeText(scheduleToTsv(schedule));
      toast.success("Schedule copied to clipboard (TSV).");
    } catch {
      toast.error("Could not copy. Browser may have blocked clipboard access.");
    }
  }

  async function downloadPdf(): Promise<void> {
    try {
      const res = await fetch("/api/v1/workbench/pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master, rows, loanDetails }),
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          detail = (JSON.parse(text) as { detail?: string }).detail ?? detail;
        } catch {
          // fall through
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(master.label)}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card className="print:shadow-none print:border-0">
      <CardHeader className="flex flex-row items-center justify-between print:hidden">
        <CardTitle>Schedule</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void copyTsv()}>
            <Clipboard className="h-4 w-4" />
            Copy TSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void downloadPdf()}>
            <Printer className="h-4 w-4" />
            Download PDF
          </Button>
          <span
            className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
            title="Hover any cell in the schedule below to see the underlying formula and inputs that produced it."
          >
            <HelpCircle className="h-3 w-3" />
            Hover row → show the math
          </span>
        </div>
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

        <div className="print:hidden">
          <div className="flex gap-2 border-b border-border pb-2">
            <ChartTab active={chart === "stacked"} onClick={() => setChart("stacked")}>
              Principal vs interest
            </ChartTab>
            <ChartTab active={chart === "balance"} onClick={() => setChart("balance")}>
              Balance over time
            </ChartTab>
            <ChartTab
              active={chart === "cumulative-interest"}
              onClick={() => setChart("cumulative-interest")}
            >
              Cumulative interest
            </ChartTab>
          </div>
          <div className="mt-3">
            <ScheduleChart schedule={schedule} kind={chart} />
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border print:overflow-visible print:rounded-none print:border-0">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1">Event</th>
                <th className="px-2 py-1 text-right">Opening</th>
                <th className="px-2 py-1 text-right">Interest</th>
                <th className="px-2 py-1 text-right">Payment</th>
                <th className="px-2 py-1 text-right">Principal</th>
                <th className="px-2 py-1 text-right">Closing</th>
                <th className="px-2 py-1 text-right">Cum. interest</th>
                <th className="px-2 py-1">Memo</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.map((r, i) => {
                const yearEnd = isYearEnd(r.date);
                const math = deriveMathTooltip(r, master);
                return (
                  <tr
                    key={i}
                    title={math}
                    className={cn(
                      "cursor-help border-t border-border",
                      r.negativeAm && "bg-destructive/5",
                      yearEnd && "bg-secondary/40 font-semibold",
                    )}
                  >
                    <td className="px-2 py-1">{r.date.toISOString().slice(0, 10)}</td>
                    <td className="px-2 py-1">{r.kind}</td>
                    <td className="px-2 py-1 text-right">{r.opening.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.interestAccrued.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.paymentApplied.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.principalApplied.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.closing.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.cumulativeInterest.toFixed(2)}</td>
                    <td className="px-2 py-1 truncate max-w-xs">{r.memo ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs",
        active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Phase 11.3 / 11.17 — Series editor.
 *
 * MVP: a kind / amount / count / interval / start-date form that
 * inserts a single recurring row. The Phase 7 cash-flow engine's
 * event normalizer expands `(kind=payment, amount=$609, count=24,
 * interval=monthly)` into 24 atomic per-period entries at compute
 * time. Stepped-amount / stepped-percentage / skip-pattern series
 * (Phase 7.11 §11.3 advanced cases) are deferred to a follow-up;
 * the present-form maps to the most-asked workflow ("set up a
 * 360-month payment series").
 */
function SeriesEditor({
  onCancel,
  onInsert,
}: {
  onCancel: () => void;
  onInsert: (row: Partial<GridRow>) => void;
}): JSX.Element {
  const [kind, setKind] = useState<CashFlowEventKind>("payment");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("12");
  const [interval, setInterval] = useState<CompoundingInterval>("monthly");
  const [memo, setMemo] = useState("");
  return (
    <CardContent className="border-y border-border bg-muted/30">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Insert series</h3>
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CashFlowEventKind)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Amount per period">
          <MoneyInput value={amount} onChange={setAmount} symbol="" />
        </Field>
        <Field label="Number of periods">
          <Input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="text-right"
          />
        </Field>
        <Field label="Interval">
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as CompoundingInterval)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {INTERVAL_OPTIONS.filter((x) => x !== "").map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Memo (optional)">
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!date || !amount || !count || Number(count) < 1}
          onClick={() =>
            onInsert({
              date,
              kind,
              amount,
              count,
              interval,
              memo,
            })
          }
        >
          Insert
        </Button>
      </div>
    </CardContent>
  );
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workbench"
  );
}

function isYearEnd(date: Date): boolean {
  return date.getUTCMonth() === 11 && date.getUTCDate() === 31;
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
