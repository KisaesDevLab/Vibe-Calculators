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
  /**
   * Phase 11.17 — Set Unknown flags. When true, the corresponding
   * cell is the variable the solver is asked to compute. Exactly one
   * unknown across the whole grid is supported in this round; multiple
   * unknowns map to a system the closed-form solvers don't handle and
   * surface a structured error.
   */
  amountUnknown?: boolean;
  rateValueUnknown?: boolean;
  countUnknown?: boolean;
}

export interface MasterUiState {
  label: string;
  rate: string; // canonical decimal fraction
  compounding: CompoundingInterval;
  dayCount: DayCountConvention;
  paymentTiming: 0 | 1;
  computeMethod: ComputeMethod;
}

/**
 * Phase 11.16 — Loan Details metadata.
 *
 * These fields don't affect the math; they flow into the PDF header
 * (preparer / borrower / lender block) and any future scheduling-
 * narrative templates. Stored in zustand alongside the master so a
 * "Save calculation" round-trip preserves them.
 */
export interface LoanDetailsState {
  borrowerName: string;
  lenderName: string;
  loanType: string;
  preparedBy: string;
  preparedOn: string; // ISO YYYY-MM-DD; blank = use today at PDF time
  originalLoanDate: string;
  notes: string;
  custom1: string;
  custom2: string;
  custom3: string;
}

/**
 * Phase 11.20 — undo / redo snapshot.
 *
 * The history stack holds the last 100 user-editable snapshots. We
 * persist the most recent snapshot to localStorage so the workbench
 * survives a page refresh; that's a smaller-scope alternative to the
 * build-plan's IndexedDB target which is overkill for this workload.
 */
export interface WorkbenchSnapshot {
  master: MasterUiState;
  rows: GridRow[];
  loanDetails: LoanDetailsState;
  rowAnnotations: Record<string, string>;
}

const HISTORY_LIMIT = 100;
/**
 * Phase 11.19 — multi-tab support.
 *
 * The active tab's state is the live store (master, rows, loanDetails,
 * rowAnnotations, past, future, currentCalcId, currentVersion). Each
 * tab also persists independently to localStorage at
 * `vibecalc.workbench.tab.<id>` so a refresh restores every tab.
 * The tab-list registry lives at `vibecalc.workbench.tabs.v1` =
 * `{ tabs: [{id,name}], activeTabId }`.
 */
const PERSIST_KEY_PREFIX = "vibecalc.workbench.tab.";
const TABS_REGISTRY_KEY = "vibecalc.workbench.tabs.v1";

export interface WorkbenchTabMeta {
  id: string;
  name: string;
}

function newTabId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

interface WorkbenchState {
  master: MasterUiState;
  rows: GridRow[];
  selectedRowId: string | null;
  loanDetails: LoanDetailsState;
  /** Set after Save → POST /api/v1/calculations succeeds. Subsequent saves
   *  go through /calculations/:id/save and create a new immutable version. */
  currentCalcId: string | null;
  /** Bumped by each successful Save; informs the Save button label. */
  currentVersion: number;
  /** Phase 11.19 — open tabs. The first entry is created on app boot
   *  if no tabs registry exists. */
  tabs: WorkbenchTabMeta[];
  /** Active tab id; the live state above belongs to this tab. */
  activeTabId: string;
  /** Snapshots before the current state (most recent at the end). */
  past: WorkbenchSnapshot[];
  /** Snapshots after the current state (most recent at the start). */
  future: WorkbenchSnapshot[];
  /**
   * Phase 12.5 — per-row annotations on the *schedule* (not the input
   * grid). Keyed by ISO YYYY-MM-DD of the row's date. The Phase-21
   * /save endpoint already accepts a `rowAnnotations: Record<string,
   * string>` payload that lands on calculation_versions.row_annotations,
   * so this round-trips with no schema change.
   */
  rowAnnotations: Record<string, string>;

  // Actions
  setMaster: <K extends keyof MasterUiState>(key: K, value: MasterUiState[K]) => void;
  insertRowAfter: (rowId: string | null) => string;
  deleteRow: (rowId: string) => void;
  updateRow: <K extends keyof GridRow>(rowId: string, key: K, value: GridRow[K]) => void;
  selectRow: (rowId: string | null) => void;
  reset: () => void;
  loadFromEvents: (rows: GridRow[], master: MasterUiState) => void;
  /** Sort the grid rows in-place by ISO date ascending. Empty dates sink to the bottom. */
  sortByDate: () => void;
  setLoanDetail: <K extends keyof LoanDetailsState>(key: K, value: LoanDetailsState[K]) => void;
  setSaveContext: (id: string, version: number) => void;
  setRowAnnotation: (dateKey: string, note: string) => void;
  /** Move a row by `delta` positions (negative = up, positive = down). Out-of-range delta clamps. */
  moveRow: (rowId: string, delta: number) => void;
  /** Phase 11.17 — toggle one of the U flags on a single cell. */
  toggleUnknown: (rowId: string, key: "amount" | "rateValue" | "count") => void;
  /** Phase 11.17 — clear every U flag across every row. */
  clearAllUnknowns: () => void;
  /** Reorder a row to land directly above another. Used by drag-and-drop. */
  reorderRow: (sourceId: string, targetId: string) => void;
  /** Push current state into past, then apply mutator. */
  undo: () => void;
  redo: () => void;
  /** Re-hydrate from localStorage. Called once on app boot. */
  restoreFromLocal: () => void;
  /** Phase 11.19 — multi-tab actions. */
  newTab: (name?: string) => string;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  /**
   * Load a previously-saved calculation's `inputs` JSON (the
   * { master, rows, loanDetails } blob the workbench writes on Save)
   * back into the store. Replaces all state. Used by the
   * /calculations index → "Open in workbench" flow and by the
   * what-if duplicate action.
   */
  loadFromCalculation: (
    inputs: {
      master: MasterUiState;
      rows: GridRow[];
      loanDetails?: LoanDetailsState;
      rowAnnotations?: Record<string, string>;
    },
    saveContext?: { id: string; version: number },
  ) => void;
  /**
   * Phase 23 — seed the workbench from a Phase 23 loan-extraction
   * result. Maps the LoanExtraction shape (as JSON) into:
   *   - master.rate           ← interestRate
   *   - master.compounding    ← compounding (normalized to enum)
   *   - first row (loan)      ← firstPaymentDate, principal
   *   - second row (payments) ← firstPaymentDate, paymentAmount,
   *                             paymentFrequency → interval, termMonths
   *                             → count
   *   - loanDetails           ← borrower / lender / notes
   * Unknown / null fields fall through to defaults; the operator
   * fills the gaps in the grid.
   */
  seedFromExtraction: (raw: Record<string, unknown>) => void;
}

/** Convert a free-form compounding string ("monthly", "Annually") to the enum we accept. */
function normalizeCompounding(s: unknown): CompoundingInterval {
  if (typeof s !== "string") return "monthly";
  const lower = s.toLowerCase().trim();
  if (lower.includes("annual") && !lower.includes("semi")) return "annual";
  if (lower.includes("semi")) return "semi-annual";
  if (lower.includes("quarter")) return "quarterly";
  if (lower.includes("biweek")) return "biweekly";
  if (lower.includes("weekly") && !lower.includes("bi")) return "weekly";
  if (lower.includes("daily")) return "daily";
  return "monthly";
}

/** Convert a payment-frequency string ("monthly", "every 2 weeks") to a row Interval. */
function normalizeFrequency(s: unknown): CompoundingInterval | "" {
  if (typeof s !== "string" || s.trim() === "") return "";
  return normalizeCompounding(s);
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

const DEFAULT_LOAN_DETAILS: LoanDetailsState = {
  borrowerName: "",
  lenderName: "",
  loanType: "",
  preparedBy: "",
  preparedOn: "",
  originalLoanDate: "",
  notes: "",
  custom1: "",
  custom2: "",
  custom3: "",
};

function snapshot(
  s: Pick<WorkbenchState, "master" | "rows" | "loanDetails" | "rowAnnotations">,
): WorkbenchSnapshot {
  return {
    master: { ...s.master },
    rows: s.rows.map((r) => ({ ...r })),
    loanDetails: { ...s.loanDetails },
    rowAnnotations: { ...s.rowAnnotations },
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistTabRegistry(s: WorkbenchState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TABS_REGISTRY_KEY,
      JSON.stringify({ tabs: s.tabs, activeTabId: s.activeTabId }),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

function persistTabState(tabId: string, s: WorkbenchState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${PERSIST_KEY_PREFIX}${tabId}`,
      JSON.stringify({
        master: s.master,
        rows: s.rows,
        loanDetails: s.loanDetails,
        rowAnnotations: s.rowAnnotations,
        currentCalcId: s.currentCalcId,
        currentVersion: s.currentVersion,
      }),
    );
  } catch {
    // ignore
  }
}

function readTabState(tabId: string): Partial<WorkbenchState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${PERSIST_KEY_PREFIX}${tabId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<WorkbenchState>;
  } catch {
    return null;
  }
}

function persist(s: WorkbenchState): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTabState(s.activeTabId, s);
    persistTabRegistry(s);
  }, 500);
}

/** Mutate with history. Pushes the current snapshot onto past, clears
 *  redo, applies the mutator, persists. */
function withHistory<T extends Partial<WorkbenchState>>(
  set: (updater: (s: WorkbenchState) => WorkbenchState | Partial<WorkbenchState>) => void,
  mutator: (s: WorkbenchState) => T,
): void {
  set((s) => {
    const before = snapshot(s);
    const patch = mutator(s);
    const past = [...s.past, before].slice(-HISTORY_LIMIT);
    const next = { ...s, ...patch, past, future: [] as WorkbenchSnapshot[] } as WorkbenchState;
    persist(next);
    return next;
  });
}

const INITIAL_TAB_ID = newTabId();

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  master: { ...DEFAULT_MASTER },
  rows: [emptyRow()],
  selectedRowId: null,
  loanDetails: { ...DEFAULT_LOAN_DETAILS },
  currentCalcId: null,
  currentVersion: 0,
  rowAnnotations: {},
  past: [],
  future: [],
  tabs: [{ id: INITIAL_TAB_ID, name: "Tab 1" }],
  activeTabId: INITIAL_TAB_ID,

  newTab: (name) => {
    const id = newTabId();
    set((s) => {
      // Save the current tab's state, then switch to a fresh blank tab.
      persistTabState(s.activeTabId, s);
      const tabs = [...s.tabs, { id, name: name ?? `Tab ${s.tabs.length + 1}` }];
      const next: WorkbenchState = {
        ...s,
        master: { ...DEFAULT_MASTER },
        rows: [emptyRow()],
        loanDetails: { ...DEFAULT_LOAN_DETAILS },
        rowAnnotations: {},
        currentCalcId: null,
        currentVersion: 0,
        past: [],
        future: [],
        tabs,
        activeTabId: id,
      };
      persistTabRegistry(next);
      return next;
    });
    return id;
  },

  switchTab: (id) =>
    set((s) => {
      if (id === s.activeTabId) return s;
      if (!s.tabs.some((t) => t.id === id)) return s;
      // Save current tab's snapshot, load target's.
      persistTabState(s.activeTabId, s);
      const target = readTabState(id);
      const next: WorkbenchState = {
        ...s,
        master: { ...DEFAULT_MASTER, ...(target?.master ?? {}) },
        rows:
          Array.isArray(target?.rows) && target.rows.length > 0
            ? (target.rows as GridRow[])
            : [emptyRow()],
        loanDetails: { ...DEFAULT_LOAN_DETAILS, ...(target?.loanDetails ?? {}) },
        rowAnnotations:
          target?.rowAnnotations && typeof target.rowAnnotations === "object"
            ? target.rowAnnotations
            : {},
        currentCalcId: target?.currentCalcId ?? null,
        currentVersion: target?.currentVersion ?? 0,
        past: [],
        future: [],
        activeTabId: id,
      };
      persistTabRegistry(next);
      return next;
    }),

  closeTab: (id) =>
    set((s) => {
      if (s.tabs.length <= 1) return s; // Don't close the last tab.
      const tabs = s.tabs.filter((t) => t.id !== id);
      // Drop the closed tab's persisted state.
      try {
        window.localStorage.removeItem(`${PERSIST_KEY_PREFIX}${id}`);
      } catch {
        // ignore
      }
      // If we closed the active tab, switch to the previous in the list.
      if (id !== s.activeTabId) {
        persistTabRegistry({ ...s, tabs });
        return { ...s, tabs };
      }
      const idx = s.tabs.findIndex((t) => t.id === id);
      const fallback = tabs[Math.max(0, idx - 1)] ?? tabs[0]!;
      const target = readTabState(fallback.id);
      const next: WorkbenchState = {
        ...s,
        master: { ...DEFAULT_MASTER, ...(target?.master ?? {}) },
        rows:
          Array.isArray(target?.rows) && target.rows.length > 0
            ? (target.rows as GridRow[])
            : [emptyRow()],
        loanDetails: { ...DEFAULT_LOAN_DETAILS, ...(target?.loanDetails ?? {}) },
        rowAnnotations:
          target?.rowAnnotations && typeof target.rowAnnotations === "object"
            ? target.rowAnnotations
            : {},
        currentCalcId: target?.currentCalcId ?? null,
        currentVersion: target?.currentVersion ?? 0,
        past: [],
        future: [],
        tabs,
        activeTabId: fallback.id,
      };
      persistTabRegistry(next);
      return next;
    }),

  renameTab: (id, name) =>
    set((s) => {
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, name } : t));
      const next = { ...s, tabs };
      persistTabRegistry(next);
      return next;
    }),

  setMaster: (key, value) => withHistory(set, (s) => ({ master: { ...s.master, [key]: value } })),

  insertRowAfter: (rowId) => {
    const r = emptyRow();
    withHistory(set, (s) => {
      if (rowId === null) return { rows: [...s.rows, r] };
      const idx = s.rows.findIndex((x) => x.rowId === rowId);
      const next = [...s.rows];
      next.splice(idx + 1, 0, r);
      return { rows: next };
    });
    return r.rowId;
  },

  deleteRow: (rowId) =>
    withHistory(set, (s) => ({
      rows: s.rows.length > 1 ? s.rows.filter((r) => r.rowId !== rowId) : s.rows,
    })),

  updateRow: (rowId, key, value) =>
    withHistory(set, (s) => ({
      rows: s.rows.map((r) => (r.rowId === rowId ? { ...r, [key]: value } : r)),
    })),

  undo: () =>
    set((s) => {
      const past = s.past;
      if (past.length === 0) return s;
      const previous = past[past.length - 1]!;
      const newPast = past.slice(0, -1);
      const present: WorkbenchSnapshot = snapshot(s);
      const next = {
        ...s,
        master: previous.master,
        rows: previous.rows,
        loanDetails: previous.loanDetails,
        rowAnnotations: previous.rowAnnotations,
        past: newPast,
        future: [present, ...s.future].slice(0, HISTORY_LIMIT),
      };
      persist(next);
      return next;
    }),

  redo: () =>
    set((s) => {
      const future = s.future;
      if (future.length === 0) return s;
      const target = future[0]!;
      const newFuture = future.slice(1);
      const present: WorkbenchSnapshot = snapshot(s);
      const next = {
        ...s,
        master: target.master,
        rows: target.rows,
        loanDetails: target.loanDetails,
        rowAnnotations: target.rowAnnotations,
        past: [...s.past, present].slice(-HISTORY_LIMIT),
        future: newFuture,
      };
      persist(next);
      return next;
    }),

  restoreFromLocal: () =>
    set((s) => {
      if (typeof window === "undefined") return s;
      try {
        // Phase 11.19 — read the tab registry first, then load the
        // active tab's snapshot. Falls back to the boot defaults
        // when no registry exists (first run).
        const reg = window.localStorage.getItem(TABS_REGISTRY_KEY);
        if (reg) {
          const parsed = JSON.parse(reg) as {
            tabs?: WorkbenchTabMeta[];
            activeTabId?: string;
          };
          if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0 && parsed.activeTabId) {
            const target = readTabState(parsed.activeTabId);
            return {
              ...s,
              tabs: parsed.tabs,
              activeTabId: parsed.activeTabId,
              master: { ...DEFAULT_MASTER, ...(target?.master ?? {}) },
              rows:
                Array.isArray(target?.rows) && target.rows.length > 0
                  ? (target.rows as GridRow[])
                  : s.rows,
              loanDetails: { ...DEFAULT_LOAN_DETAILS, ...(target?.loanDetails ?? {}) },
              rowAnnotations:
                target?.rowAnnotations && typeof target.rowAnnotations === "object"
                  ? target.rowAnnotations
                  : {},
              currentCalcId: target?.currentCalcId ?? null,
              currentVersion: target?.currentVersion ?? 0,
            };
          }
        }
        return s;
      } catch {
        return s;
      }
    }),

  selectRow: (rowId) => set({ selectedRowId: rowId }),

  moveRow: (rowId, delta) =>
    withHistory(set, (s) => {
      const idx = s.rows.findIndex((r) => r.rowId === rowId);
      if (idx < 0) return {};
      const newIdx = Math.max(0, Math.min(s.rows.length - 1, idx + delta));
      if (newIdx === idx) return {};
      const next = [...s.rows];
      const [picked] = next.splice(idx, 1);
      if (!picked) return {};
      next.splice(newIdx, 0, picked);
      return { rows: next };
    }),

  toggleUnknown: (rowId, key) =>
    withHistory(set, (s) => {
      const flagKey = `${key}Unknown` as "amountUnknown" | "rateValueUnknown" | "countUnknown";
      // Enforce exactly-one-unknown invariant: setting a new U on a
      // different cell clears every other U automatically. Toggling
      // the *same* cell off doesn't clear others.
      const targetRow = s.rows.find((r) => r.rowId === rowId);
      const turningOn = !targetRow?.[flagKey];
      return {
        rows: s.rows.map((r) => {
          if (r.rowId === rowId) {
            return { ...r, [flagKey]: turningOn };
          }
          if (turningOn) {
            const cleared = { ...r };
            delete cleared.amountUnknown;
            delete cleared.rateValueUnknown;
            delete cleared.countUnknown;
            return cleared;
          }
          return r;
        }),
      };
    }),

  clearAllUnknowns: () =>
    withHistory(set, (s) => ({
      rows: s.rows.map((r) => {
        const cleared = { ...r };
        delete cleared.amountUnknown;
        delete cleared.rateValueUnknown;
        delete cleared.countUnknown;
        return cleared;
      }),
    })),

  reorderRow: (sourceId, targetId) =>
    withHistory(set, (s) => {
      if (sourceId === targetId) return {};
      const sourceIdx = s.rows.findIndex((r) => r.rowId === sourceId);
      const targetIdx = s.rows.findIndex((r) => r.rowId === targetId);
      if (sourceIdx < 0 || targetIdx < 0) return {};
      const next = [...s.rows];
      const [picked] = next.splice(sourceIdx, 1);
      if (!picked) return {};
      // Insert before the target's *new* index after removal.
      const insertIdx = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
      next.splice(insertIdx, 0, picked);
      return { rows: next };
    }),

  reset: () =>
    set({
      master: { ...DEFAULT_MASTER },
      rows: [emptyRow()],
      loanDetails: { ...DEFAULT_LOAN_DETAILS },
      currentCalcId: null,
      currentVersion: 0,
      past: [],
      future: [],
      rowAnnotations: {},
    }),

  setSaveContext: (id, version) => set({ currentCalcId: id, currentVersion: version }),

  setRowAnnotation: (dateKey, note) =>
    set((s) => {
      const next = { ...s.rowAnnotations };
      if (!note.trim()) {
        delete next[dateKey];
      } else {
        next[dateKey] = note;
      }
      return { rowAnnotations: next };
    }),

  loadFromCalculation: (inputs, saveContext) =>
    set({
      master: { ...DEFAULT_MASTER, ...inputs.master },
      rows: Array.isArray(inputs.rows) && inputs.rows.length > 0 ? inputs.rows : [emptyRow()],
      loanDetails: { ...DEFAULT_LOAN_DETAILS, ...(inputs.loanDetails ?? {}) },
      rowAnnotations:
        inputs.rowAnnotations && typeof inputs.rowAnnotations === "object"
          ? { ...inputs.rowAnnotations }
          : {},
      currentCalcId: saveContext?.id ?? null,
      currentVersion: saveContext?.version ?? 0,
      selectedRowId: null,
    }),

  loadFromEvents: (rows, master) => set({ rows, master, selectedRowId: null }),

  setLoanDetail: (key, value) => set((s) => ({ loanDetails: { ...s.loanDetails, [key]: value } })),

  seedFromExtraction: (raw) =>
    set((s) => {
      const principal = typeof raw.principal === "number" ? raw.principal : null;
      const interestRate = typeof raw.interestRate === "number" ? raw.interestRate : null;
      const termMonths = typeof raw.termMonths === "number" ? raw.termMonths : null;
      const paymentAmount = typeof raw.paymentAmount === "number" ? raw.paymentAmount : null;
      const firstPayment = typeof raw.firstPaymentDate === "string" ? raw.firstPaymentDate : "";
      const compounding = normalizeCompounding(raw.compounding);
      const interval = normalizeFrequency(raw.paymentFrequency) || compounding;
      const borrower = (raw.borrower as { name?: unknown } | undefined)?.name;
      const lender = (raw.lender as { name?: unknown } | undefined)?.name;
      const notesField = typeof raw.notes === "string" ? raw.notes : "";

      const newMaster: MasterUiState = {
        ...s.master,
        ...(interestRate !== null ? { rate: String(interestRate) } : {}),
        compounding,
        label: borrower
          ? `Loan to ${String(borrower)}`
          : `Extracted ${new Date().toISOString().slice(0, 10)}`,
      };

      const rows: GridRow[] = [];
      if (principal !== null && firstPayment) {
        rows.push({
          ...emptyRow(),
          date: firstPayment,
          kind: "loan",
          amount: String(principal),
          memo: "Extracted from agreement",
        });
      }
      if (paymentAmount !== null && termMonths && firstPayment) {
        rows.push({
          ...emptyRow(),
          date: firstPayment,
          kind: "payment",
          amount: String(paymentAmount),
          count: String(termMonths),
          interval,
          memo: "Extracted payment series",
        });
      }
      if (rows.length === 0) rows.push(emptyRow());

      return {
        master: newMaster,
        rows,
        loanDetails: {
          ...s.loanDetails,
          ...(typeof borrower === "string" ? { borrowerName: borrower } : {}),
          ...(typeof lender === "string" ? { lenderName: lender } : {}),
          ...(notesField ? { notes: notesField } : {}),
        },
      };
    }),

  sortByDate: () =>
    set((s) => ({
      // Phase 11.17 — Sort by Date ascending. Tie-break: Loan first, then
      // Rate Change, then balance-touching events, then memo. Empty
      // dates sink to the bottom so the user notices them.
      rows: [...s.rows].sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const order: Record<string, number> = {
          loan: 0,
          rate_change: 1,
          deposit: 2,
          payment: 2,
          withdrawal: 2,
          balloon: 2,
          prepayment: 2,
          interest_only: 2,
          stepped_amount: 2,
          memo: 3,
        };
        return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
      }),
    })),
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
