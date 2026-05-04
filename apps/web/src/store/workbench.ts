import { create } from "zustand";
import type {
  CashFlowEvent,
  CashFlowEventKind,
  CompoundingInterval,
  ComputeMethod,
  DayCountConvention,
  MasterCalculationSettings,
} from "@vibe-calc/calc-engine";
import { money, rate, type Rate } from "@vibe-calc/calc-engine";

/**
 * Phase 11 — workbench state.
 *
 * The user-edited grid + master settings live here. The schedule is
 * derived (computed in the page from this state) so we don't store
 * it.
 *
 * Per CLAUDE.md zustand is for ephemeral UI state — but the
 * calculation in-progress IS ephemeral until the operator hits
 * Save. The Phase 7 cash-flow engine is the source of truth at run
 * time; this store just holds the editable inputs.
 */

export interface GridRow {
  /** Stable id used by React keys; does not round-trip to the server. */
  rowId: string;
  date: string; // ISO YYYY-MM-DD
  kind: CashFlowEventKind;
  /** Decimal string (Money) or empty. */
  amount: string;
  /** Decimal-fraction string (Rate) or empty. */
  rateValue: string;
  /** Recurring count. Empty for atomic. */
  count: string;
  /** Period interval; "" = inherit from master. */
  interval: CompoundingInterval | "";
  memo: string;
}

export interface MasterUiState {
  label: string;
  rate: string; // canonical decimal fraction
  compounding: CompoundingInterval;
  dayCount: DayCountConvention;
  paymentTiming: 0 | 1;
  computeMethod: ComputeMethod;
}

interface WorkbenchState {
  master: MasterUiState;
  rows: GridRow[];
  selectedRowId: string | null;

  // Actions
  setMaster: <K extends keyof MasterUiState>(key: K, value: MasterUiState[K]) => void;
  insertRowAfter: (rowId: string | null) => string;
  deleteRow: (rowId: string) => void;
  updateRow: <K extends keyof GridRow>(rowId: string, key: K, value: GridRow[K]) => void;
  selectRow: (rowId: string | null) => void;
  reset: () => void;
  loadFromEvents: (rows: GridRow[], master: MasterUiState) => void;
}

let nextId = 1;
function newRowId(): string {
  nextId += 1;
  return `r${nextId}`;
}

function emptyRow(): GridRow {
  return {
    rowId: newRowId(),
    date: "",
    kind: "loan",
    amount: "",
    rateValue: "",
    count: "",
    interval: "",
    memo: "",
  };
}

const DEFAULT_MASTER: MasterUiState = {
  label: "New TVM calculation",
  rate: "0.06",
  compounding: "monthly",
  dayCount: "30/360",
  paymentTiming: 0,
  computeMethod: "Normal",
};

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  master: { ...DEFAULT_MASTER },
  rows: [emptyRow()],
  selectedRowId: null,

  setMaster: (key, value) => set((s) => ({ master: { ...s.master, [key]: value } })),

  insertRowAfter: (rowId) => {
    const r = emptyRow();
    set((s) => {
      if (rowId === null) return { rows: [...s.rows, r] };
      const idx = s.rows.findIndex((x) => x.rowId === rowId);
      const next = [...s.rows];
      next.splice(idx + 1, 0, r);
      return { rows: next };
    });
    return r.rowId;
  },

  deleteRow: (rowId) =>
    set((s) => ({
      rows: s.rows.length > 1 ? s.rows.filter((r) => r.rowId !== rowId) : s.rows,
    })),

  updateRow: (rowId, key, value) =>
    set((s) => ({
      rows: s.rows.map((r) => (r.rowId === rowId ? { ...r, [key]: value } : r)),
    })),

  selectRow: (rowId) => set({ selectedRowId: rowId }),

  reset: () => set({ master: { ...DEFAULT_MASTER }, rows: [emptyRow()] }),

  loadFromEvents: (rows, master) => set({ rows, master, selectedRowId: null }),
}));

// ---------------------------------------------------------------------
// Derived helpers — convert UI rows to engine inputs.
// ---------------------------------------------------------------------

export function rowsToEvents(rows: GridRow[]): CashFlowEvent[] {
  return rows
    .filter((r) => r.date && r.kind)
    .map((r) => {
      const date = new Date(`${r.date}T00:00:00.000Z`);
      const event: CashFlowEvent = { date, kind: r.kind };
      if (r.amount) event.amount = money(r.amount);
      if (r.rateValue) event.rate = rate(r.rateValue);
      if (r.count) event.count = Number(r.count);
      if (r.interval) event.interval = r.interval;
      if (r.memo) event.memo = r.memo;
      return event;
    });
}

export function masterToSettings(master: MasterUiState): MasterCalculationSettings {
  return {
    rate: rate(master.rate) as Rate,
    compounding: master.compounding,
    dayCount: master.dayCount,
    paymentTiming: master.paymentTiming,
    computeMethod: master.computeMethod,
  };
}
