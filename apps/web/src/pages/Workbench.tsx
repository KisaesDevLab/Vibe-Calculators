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
  Save,
  Send,
  Undo2,
  Redo2,
  Sigma,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { solveWorkbench } from "@/lib/workbench-solver";
import { ScheduleChart, scheduleToTsv, type ChartKind } from "@/components/schedule/ScheduleChart";
import {
  VirtualScheduleTable,
  VIRTUALIZE_THRESHOLD,
} from "@/components/schedule/VirtualScheduleTable";
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
import { VarianceDialog } from "@/components/workbench/VarianceDialog";
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

/**
 * Phase 11.18 — period-dropdown smart filtering.
 *
 * Approximate days per period; used to enforce "row's period must
 * be ≥ master's" — anything shorter than the master compounding
 * doesn't tile cleanly and the engine will mis-allocate interest
 * across sub-period boundaries.
 */
const PERIOD_DAYS: Partial<Record<CompoundingInterval, number>> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  "half-month": 15,
  "four-week": 28,
  monthly: 30.44,
  "bi-monthly": 60.88,
  quarterly: 91.31,
  "semi-annual": 182.62,
  annual: 365.25,
  // continuous and exact-days don't sit on the regular calendar so
  // we leave them out of the compatibility check; treat as "always
  // compatible" via the fallback below.
};

function isIntervalCompatible(
  rowInterval: CompoundingInterval | "",
  masterCompounding: CompoundingInterval,
): boolean {
  if (rowInterval === "") return true; // inherit always works
  const row = PERIOD_DAYS[rowInterval];
  const master = PERIOD_DAYS[masterCompounding];
  if (row === undefined || master === undefined) return true; // continuous / exact-days bypass
  return row >= master;
}

/**
 * Phase 11.13 — empty-state templates.
 *
 * Each template provides master settings + a starter row set. The
 * operator picks one, every field is editable from there.
 */
interface EmptyStateTemplate {
  label: string;
  master: {
    rate: string;
    compounding: CompoundingInterval;
    dayCount: DayCountConvention;
    paymentTiming: 0 | 1;
    computeMethod: ComputeMethod;
  };
  rows: Array<{
    date: string;
    kind: CashFlowEventKind;
    amount: string;
    rateValue?: string;
    count?: string;
    interval?: CompoundingInterval | "";
    memo?: string;
  }>;
}

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_STATE_TEMPLATES: EmptyStateTemplate[] = [
  {
    label: "30-year mortgage",
    master: {
      rate: "0.065",
      compounding: "monthly",
      dayCount: "30/360",
      paymentTiming: 0,
      computeMethod: "Normal",
    },
    rows: [
      { date: TODAY, kind: "loan", amount: "300000", memo: "Principal" },
      {
        date: TODAY,
        kind: "payment",
        amount: "1896.20",
        count: "360",
        interval: "monthly",
        memo: "Level monthly P&I",
      },
    ],
  },
  {
    label: "5-year auto loan",
    master: {
      rate: "0.07",
      compounding: "monthly",
      dayCount: "30/360",
      paymentTiming: 0,
      computeMethod: "Normal",
    },
    rows: [
      { date: TODAY, kind: "loan", amount: "30000", memo: "Vehicle financed" },
      {
        date: TODAY,
        kind: "payment",
        amount: "594.04",
        count: "60",
        interval: "monthly",
        memo: "Level monthly payment",
      },
    ],
  },
  {
    label: "10-year balloon",
    master: {
      rate: "0.08",
      compounding: "monthly",
      dayCount: "30/360",
      paymentTiming: 0,
      computeMethod: "Normal",
    },
    rows: [
      { date: TODAY, kind: "loan", amount: "1000000" },
      {
        date: TODAY,
        kind: "payment",
        amount: "7337.65",
        count: "120",
        interval: "monthly",
        memo: "30-year amortization",
      },
      { date: TODAY, kind: "balloon", amount: "877247", memo: "Balloon at month 120" },
    ],
  },
  {
    label: "5-year savings goal",
    master: {
      rate: "0.045",
      compounding: "monthly",
      dayCount: "30/360",
      paymentTiming: 0,
      computeMethod: "Normal",
    },
    rows: [
      { date: TODAY, kind: "deposit", amount: "0", memo: "Starting balance" },
      {
        date: TODAY,
        kind: "deposit",
        amount: "500",
        count: "60",
        interval: "monthly",
        memo: "Monthly contribution",
      },
    ],
  },
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
  const moveRow = useWorkbenchStore((s) => s.moveRow);
  const reorderRow = useWorkbenchStore((s) => s.reorderRow);
  const toggleUnknown = useWorkbenchStore((s) => s.toggleUnknown);
  const clearAllUnknowns = useWorkbenchStore((s) => s.clearAllUnknowns);

  function solveUnknown(): void {
    const result = solveWorkbench(rows, master);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    updateRow(result.rowId, result.field, result.value as never);
    // Clear the U flag on the just-solved cell.
    const flagKey =
      result.field === "amount" ? "amount" : result.field === "rateValue" ? "rateValue" : "count";
    toggleUnknown(result.rowId, flagKey);
    toast.success(`Solved: ${result.field} = ${result.value}`);
  }
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const newTab = useWorkbenchStore((s) => s.newTab);
  const switchTab = useWorkbenchStore((s) => s.switchTab);
  const closeTab = useWorkbenchStore((s) => s.closeTab);
  const renameTab = useWorkbenchStore((s) => s.renameTab);
  const setMasterRaw = useWorkbenchStore.setState;
  void setMasterRaw;
  const loanDetails = useWorkbenchStore((s) => s.loanDetails);
  const setLoanDetail = useWorkbenchStore((s) => s.setLoanDetail);
  const seedFromExtraction = useWorkbenchStore((s) => s.seedFromExtraction);
  const loadFromCalculation = useWorkbenchStore((s) => s.loadFromCalculation);
  const currentCalcId = useWorkbenchStore((s) => s.currentCalcId);
  const currentVersion = useWorkbenchStore((s) => s.currentVersion);
  const setSaveContext = useWorkbenchStore((s) => s.setSaveContext);
  const rowAnnotations = useWorkbenchStore((s) => s.rowAnnotations);
  const setRowAnnotation = useWorkbenchStore((s) => s.setRowAnnotation);
  const undo = useWorkbenchStore((s) => s.undo);
  const redo = useWorkbenchStore((s) => s.redo);
  const past = useWorkbenchStore((s) => s.past);
  const future = useWorkbenchStore((s) => s.future);
  const restoreFromLocal = useWorkbenchStore((s) => s.restoreFromLocal);
  const [loanDetailsOpen, setLoanDetailsOpen] = useState(false);
  const [seriesEditorOpen, setSeriesEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveCalculation(): Promise<void> {
    setSaving(true);
    try {
      const inputs = { master, rows, loanDetails, rowAnnotations };
      if (!currentCalcId) {
        const res = await fetch("/api/v1/calculations", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: master.label || "Untitled", kind: "tvm", inputs }),
        });
        if (!res.ok) throw new Error(await readDetail(res));
        const j = (await res.json()) as { calculation: { id: string; version: number } };
        setSaveContext(j.calculation.id, j.calculation.version ?? 1);
        toast.success(`Saved as version ${j.calculation.version ?? 1}.`);
      } else {
        const res = await fetch(`/api/v1/calculations/${encodeURIComponent(currentCalcId)}/save`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // The Phase-21 /save endpoint accepts rowAnnotations
          // alongside inputs and writes it to
          // calculation_versions.row_annotations. Pass it through.
          body: JSON.stringify({ inputs, rowAnnotations }),
        });
        if (!res.ok) throw new Error(await readDetail(res));
        const j = (await res.json()) as { version: { version: number; id: string } };
        setSaveContext(currentCalcId, j.version.version);
        toast.success(`Saved as version ${j.version.version}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Phase 11.2 — wire row drag-and-drop. The RowEditor dispatches a
  // CustomEvent on drop carrying { sourceId, targetId }; the
  // workbench listens once and forwards to the store.
  useEffect(() => {
    function handler(e: Event): void {
      const detail = (e as CustomEvent<{ sourceId: string; targetId: string }>).detail;
      if (!detail) return;
      reorderRow(detail.sourceId, detail.targetId);
    }
    window.addEventListener("vibecalc.workbench.row.drop", handler as EventListener);
    return () =>
      window.removeEventListener("vibecalc.workbench.row.drop", handler as EventListener);
  }, [reorderRow]);

  // Phase 11.20 — restore localStorage snapshot once on mount, then
  // bind cmd/ctrl+Z and cmd/ctrl+shift+Z to undo/redo. Skip the
  // restore if a clone or extraction seed is pending — those flows
  // will overwrite state anyway.
  useEffect(() => {
    const hasPendingSeed =
      typeof window !== "undefined" &&
      (sessionStorage.getItem("vibecalc.workbench.seed") ||
        sessionStorage.getItem("vibecalc.workbench.clone") ||
        new URLSearchParams(window.location.search).get("id"));
    if (!hasPendingSeed) restoreFromLocal();

    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "`") {
        // Phase 11.19 — cmd/ctrl+` cycles through open tabs.
        e.preventDefault();
        const t = useWorkbenchStore.getState();
        if (t.tabs.length <= 1) return;
        const idx = t.tabs.findIndex((tab) => tab.id === t.activeTabId);
        const nextIdx = e.shiftKey
          ? (idx - 1 + t.tabs.length) % t.tabs.length
          : (idx + 1) % t.tabs.length;
        const nextId = t.tabs[nextIdx]?.id;
        if (nextId) t.switchTab(nextId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restoreFromLocal, undo, redo]);

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

  // Phase 11.8 / 11.10 — load saved calculation by id (?id=…) or by
  // a sessionStorage clone payload (what-if duplicate). The ?id= path
  // refetches every mount; the clone payload is single-shot.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const cloneRaw = sessionStorage.getItem("vibecalc.workbench.clone");
    if (cloneRaw) {
      sessionStorage.removeItem("vibecalc.workbench.clone");
      try {
        const parsed = JSON.parse(cloneRaw) as {
          master: MasterUiState;
          rows: GridRow[];
          loanDetails?: LoanDetailsState;
        };
        loadFromCalculation(parsed);
        toast.success("Loaded what-if copy. Edit and Save to create a new calculation.");
        return;
      } catch {
        // fall through to ?id= path
      }
    }
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/calculations/${encodeURIComponent(id)}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as {
          calculation: { id: string; version: number };
          inputs: { master: MasterUiState; rows: GridRow[]; loanDetails?: LoanDetailsState };
        };
        loadFromCalculation(j.inputs, {
          id: j.calculation.id,
          version: j.calculation.version,
        });
        toast.success(
          `Loaded calculation ${j.calculation.id.slice(0, 8)} (v${j.calculation.version}).`,
        );
      } catch (err) {
        toast.error(`Failed to load calculation: ${err instanceof Error ? err.message : err}`);
      }
    })();
    // Mount-only intentionally: we hydrate from URL or sessionStorage
    // exactly once. Subsequent edits in the workbench should not
    // re-fetch and clobber the operator's in-progress changes.
  }, [loadFromCalculation]);

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
      {/* Phase 11.19 — tab strip */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTab(t.id)}
            onDoubleClick={() => {
              const next = window.prompt("Rename tab", t.name);
              if (next && next.trim()) renameTab(t.id, next.trim());
            }}
            className={cn(
              "group flex items-center gap-1 rounded-t-md px-3 py-1 text-xs",
              t.id === activeTabId
                ? "border border-b-0 border-border bg-card font-medium"
                : "text-muted-foreground hover:bg-accent",
            )}
            title={`${t.name} — double-click to rename`}
          >
            <span>{t.name}</span>
            {tabs.length > 1 && t.id === activeTabId && (
              <span
                className="ml-1 rounded p-0.5 hover:bg-destructive/20"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Close "${t.name}"? Its state is lost unless saved.`)) {
                    closeTab(t.id);
                  }
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => newTab()}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          title="New tab (cmd+` to cycle)"
        >
          + Tab
        </button>
      </div>

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
        <Button
          variant="outline"
          size="icon"
          onClick={undo}
          disabled={past.length === 0}
          aria-label="Undo (cmd+Z)"
          title="Undo (cmd+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={redo}
          disabled={future.length === 0}
          aria-label="Redo (cmd+shift+Z)"
          title="Redo (cmd+shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          onClick={solveUnknown}
          aria-label="Solve for the unknown cell"
          title="Solve for the U-flagged cell using closed-form TVM math"
        >
          <Sigma className="h-4 w-4" />
          Solve
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (confirm("Clear every U marker across the grid?")) clearAllUnknowns();
          }}
          aria-label="Restore Unknowns (clear U flags)"
        >
          <RefreshCw className="h-4 w-4" />
          Restore U
        </Button>
        <Button variant="outline" onClick={sortByDate} aria-label="Sort rows by date">
          <ArrowDownAZ className="h-4 w-4" />
          Sort
        </Button>
        <Button
          onClick={() => void saveCalculation()}
          disabled={saving}
          aria-label="Save calculation"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : currentCalcId ? `Save v${currentVersion + 1}` : "Save"}
        </Button>
        <Button variant="outline" onClick={reset} aria-label="Reset workbench">
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </header>
      {currentCalcId && (
        <p className="text-xs text-muted-foreground">
          Saved as calculation <code className="font-mono">{currentCalcId.slice(0, 8)}</code>,
          version {currentVersion}.{" "}
          <a
            href={`/calculations/${currentCalcId}/versions`}
            className="underline hover:text-foreground"
          >
            View version history →
          </a>
        </p>
      )}

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

      {/* Empty-state template picker (Phase 11.13). */}
      {rows.length === 1 && rows[0]?.date === "" && rows[0]?.amount === "" && !currentCalcId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start from a template</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Pick a starting shape; you can edit every field after the template lands.
            </p>
            <div className="flex flex-wrap gap-2">
              {EMPTY_STATE_TEMPLATES.map((tpl) => (
                <Button
                  key={tpl.label}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMaster("rate", tpl.master.rate);
                    setMaster("compounding", tpl.master.compounding);
                    setMaster("dayCount", tpl.master.dayCount);
                    setMaster("paymentTiming", tpl.master.paymentTiming);
                    setMaster("computeMethod", tpl.master.computeMethod);
                    setMaster("label", tpl.label);
                    // Replace rows: insert each preset row.
                    // The store's mutators only support insertRowAfter
                    // / updateRow, so we wipe and rebuild.
                    const ids: string[] = [];
                    for (let i = 0; i < tpl.rows.length; i++) {
                      const id = insertRowAfter(null);
                      ids.push(id);
                    }
                    // Drop the original placeholder row (always rowId=r2 at boot,
                    // but find it by being the first one we didn't just insert).
                    // Cheaper: just delete every row we didn't add.
                    const targetIds = new Set(ids);
                    for (const r of useWorkbenchStore.getState().rows) {
                      if (!targetIds.has(r.rowId)) deleteRow(r.rowId);
                    }
                    // Now populate the new rows.
                    tpl.rows.forEach((tr, idx) => {
                      const id = ids[idx]!;
                      for (const [k, v] of Object.entries(tr)) {
                        updateRow(id, k as keyof GridRow, v as never);
                      }
                    });
                    toast.success(`Loaded "${tpl.label}".`);
                  }}
                >
                  {tpl.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
                    masterCompounding={master.compounding}
                    onChange={(k, v) => updateRow(row.rowId, k, v)}
                    onDelete={() => deleteRow(row.rowId)}
                    onInsertBelow={() => insertRowAfter(row.rowId)}
                    onMoveUp={() => moveRow(row.rowId, -1)}
                    onMoveDown={() => moveRow(row.rowId, 1)}
                    onToggleUnknown={(key) => toggleUnknown(row.rowId, key)}
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
          rowAnnotations={rowAnnotations}
          setRowAnnotation={setRowAnnotation}
          updateRow={updateRow}
          insertRowAfter={insertRowAfter}
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
  rowAnnotations,
  setRowAnnotation,
  updateRow,
  insertRowAfter,
}: {
  schedule: ScheduleResult;
  master: MasterUiState;
  label: string;
  rows: GridRow[];
  loanDetails: LoanDetailsState;
  rowAnnotations: Record<string, string>;
  setRowAnnotation: (dateKey: string, note: string) => void;
  updateRow: <K extends keyof GridRow>(rowId: string, key: K, value: GridRow[K]) => void;
  insertRowAfter: (rowId: string | null) => string;
}): JSX.Element {
  const [chart, setChart] = useState<ChartKind>("stacked");
  const [varianceOpen, setVarianceOpen] = useState(false);

  async function copyTsv(): Promise<void> {
    try {
      await navigator.clipboard.writeText(scheduleToTsv(schedule));
      toast.success("Schedule copied to clipboard (TSV).");
    } catch {
      toast.error("Could not copy. Browser may have blocked clipboard access.");
    }
  }

  async function emailPdf(): Promise<void> {
    const to = window.prompt("Send the schedule PDF to (email address):", "");
    if (!to) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error("Not a valid email address.");
      return;
    }
    try {
      const res = await fetch("/api/v1/workbench/email-pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          master,
          rows,
          loanDetails,
          recipient: { to },
        }),
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
      toast.success(`Sent to ${to}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function downloadFormat(format: "csv" | "xlsx" | "docx", _mime: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/workbench/${format}`, {
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
      a.download = `${slug(master.label)}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
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
            PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void downloadFormat("csv", "text/csv")}
          >
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void downloadFormat(
                "xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              )
            }
          >
            XLSX
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void downloadFormat(
                "docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              )
            }
          >
            DOCX
          </Button>
          <Button variant="outline" size="sm" onClick={() => void emailPdf()}>
            <Send className="h-4 w-4" />
            Email
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

        {/*
         * Phase 11.17 — near-zero balance hint. When the schedule has
         * a tiny non-zero ending balance (typically because the user
         * entered a hand-rounded payment that doesn't fully amortize),
         * point them at the Solve workflow so they can fill in the
         * exact value rather than puzzle over fractional cents.
         */}
        {Math.abs(schedule.endingBalance.toNumber()) > 0.005 &&
          Math.abs(schedule.endingBalance.toNumber()) < 5 && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-50/40 px-3 py-2 text-xs dark:bg-amber-500/10">
              <span>
                <strong>Loan not fully balanced:</strong> ending balance is{" "}
                {schedule.endingBalance.toNumber() > 0 ? "+" : ""}
                {schedule.endingBalance.toFixed(2)}. The payment you entered isn't the precise
                amortizing amount.
              </span>
              <Button size="sm" variant="outline" onClick={() => setVarianceOpen(true)}>
                Resolve…
              </Button>
            </div>
          )}

        {varianceOpen && (
          <VarianceDialog
            variance={schedule.endingBalance.toNumber()}
            rows={rows}
            schedule={schedule}
            updateRow={updateRow}
            insertRowAfter={insertRowAfter}
            onClose={() => setVarianceOpen(false)}
          />
        )}

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

        {schedule.rows.length > VIRTUALIZE_THRESHOLD ? (
          <div className="print:hidden">
            <VirtualScheduleTable
              schedule={schedule}
              rowAnnotations={rowAnnotations}
              setRowAnnotation={setRowAnnotation}
              deriveMathTooltip={(row) => deriveMathTooltip(row, master)}
              isYearEnd={isYearEnd}
            />
          </div>
        ) : null}
        <div
          className={cn(
            "overflow-x-auto rounded-md border border-border print:overflow-visible print:rounded-none print:border-0",
            schedule.rows.length > VIRTUALIZE_THRESHOLD && "hidden print:block",
          )}
        >
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
                const dateKey = r.date.toISOString().slice(0, 10);
                const annotation = rowAnnotations[dateKey] ?? "";
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
                    <td className="px-2 py-1">{dateKey}</td>
                    <td className="px-2 py-1">{r.kind}</td>
                    <td className="px-2 py-1 text-right">{r.opening.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.interestAccrued.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.paymentApplied.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.principalApplied.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.closing.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{r.cumulativeInterest.toFixed(2)}</td>
                    <td className="px-2 py-1 max-w-xs truncate" title={annotation || r.memo || ""}>
                      <button
                        type="button"
                        className={cn(
                          "rounded px-1 hover:bg-accent/40",
                          annotation && "text-primary font-semibold",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = window.prompt(
                            `Annotation for ${dateKey} (Phase 12.5 — saved with version):`,
                            annotation,
                          );
                          if (next === null) return;
                          setRowAnnotation(dateKey, next);
                        }}
                      >
                        {annotation ? "📝" : "+"}
                      </button>
                      {annotation && <span className="ml-1 truncate text-xs">{annotation}</span>}
                      {!annotation && r.memo && (
                        <span className="ml-1 text-xs text-muted-foreground">{r.memo}</span>
                      )}
                    </td>
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

async function readDetail(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { detail?: string };
    return j.detail ?? `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
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

/**
 * Phase 11.17 — wraps a numeric cell with a small "U" badge that
 * toggles the Unknown flag for the cell. The badge highlights when
 * set; the surrounding input dims so the operator visually knows
 * "this value will be solved for."
 */
function CellWithUnknown({
  isUnknown,
  onToggleUnknown,
  children,
}: {
  isUnknown: boolean;
  onToggleUnknown: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleUnknown}
        title={isUnknown ? "Unflag (clear U)" : "Set as Unknown — Solve will fill this in"}
        className={cn(
          "h-6 w-6 shrink-0 rounded text-xs font-semibold transition-colors",
          isUnknown
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        U
      </button>
      <span className={cn("flex-1", isUnknown && "opacity-50")}>{children}</span>
    </div>
  );
}

interface RowEditorProps {
  row: GridRow;
  masterCompounding: CompoundingInterval;
  onChange: <K extends keyof GridRow>(key: K, value: GridRow[K]) => void;
  onDelete: () => void;
  onInsertBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleUnknown: (key: "amount" | "rateValue" | "count") => void;
}

function RowEditor({
  row,
  masterCompounding,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleUnknown,
}: RowEditorProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  function onContextMenu(e: React.MouseEvent): void {
    e.preventDefault();
    setMenuOpen(true);
  }

  function onDragStart(e: React.DragEvent<HTMLTableRowElement>): void {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.rowId);
  }
  function onDragOver(e: React.DragEvent<HTMLTableRowElement>): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function onDrop(e: React.DragEvent<HTMLTableRowElement>): void {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === row.rowId) return;
    // Workbench-level handler (passed via window event) wires the
    // actual reorder; the row only knows its own id.
    window.dispatchEvent(
      new CustomEvent("vibecalc.workbench.row.drop", {
        detail: { sourceId, targetId: row.rowId },
      }),
    );
  }

  return (
    <tr
      className="relative border-t border-border"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
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
        <CellWithUnknown
          isUnknown={Boolean(row.amountUnknown)}
          onToggleUnknown={() => onToggleUnknown("amount")}
        >
          <MoneyInput value={row.amount} onChange={(v) => onChange("amount", v)} symbol="" />
        </CellWithUnknown>
      </td>
      <td className="px-2 py-1 w-32">
        <CellWithUnknown
          isUnknown={Boolean(row.rateValueUnknown)}
          onToggleUnknown={() => onToggleUnknown("rateValue")}
        >
          <RateInput value={row.rateValue} onChange={(v) => onChange("rateValue", v)} />
        </CellWithUnknown>
      </td>
      <td className="px-2 py-1 w-20">
        <CellWithUnknown
          isUnknown={Boolean(row.countUnknown)}
          onToggleUnknown={() => onToggleUnknown("count")}
        >
          <Input
            type="text"
            inputMode="numeric"
            value={row.count}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("count", e.target.value)}
            className="text-right"
          />
        </CellWithUnknown>
      </td>
      <td className="px-2 py-1 w-32">
        <select
          value={row.interval}
          onChange={(e) => onChange("interval", e.target.value as GridRow["interval"])}
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
          title={
            row.interval && !isIntervalCompatible(row.interval, masterCompounding)
              ? `Incompatible with master compounding (${masterCompounding}). Pick a period equal to or longer than the master.`
              : undefined
          }
        >
          {INTERVAL_OPTIONS.map((iv) => {
            const compatible = isIntervalCompatible(iv, masterCompounding);
            return (
              <option key={iv || "_"} value={iv} disabled={!compatible}>
                {iv === "" ? "(inherit)" : iv}
                {!compatible ? " (too short for master)" : ""}
              </option>
            );
          })}
        </select>
      </td>
      <td className="px-2 py-1">
        <Input
          value={row.memo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("memo", e.target.value)}
        />
      </td>
      <td className="relative px-2 py-1">
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete row">
          <Trash2 className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <div
            className="absolute right-2 top-9 z-10 w-44 rounded-md border border-border bg-popover p-1 text-sm shadow-md"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
              onClick={() => {
                onMoveUp();
                setMenuOpen(false);
              }}
            >
              Move up
            </button>
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
              onClick={() => {
                onMoveDown();
                setMenuOpen(false);
              }}
            >
              Move down
            </button>
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-destructive hover:bg-destructive/10"
              onClick={() => {
                onDelete();
                setMenuOpen(false);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
