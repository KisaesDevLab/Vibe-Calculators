import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ScheduleResult } from "@vibe-calc/calc-engine";
import { Button } from "@/components/ui/button";
import type { GridRow } from "@/store/workbench";

/**
 * Phase 11.17 — TValue-style variance-resolution dialog.
 *
 * When the schedule's ending balance is non-zero (typically the
 * user entered a hand-rounded payment that doesn't fully amortize),
 * this dialog lets the operator pick where to absorb the residual
 * cents:
 *
 *   • Last Payment — split the last sub-payment off the trailing
 *     series row and adjust its amount by the variance, leaving the
 *     other payments unchanged.
 *   • Balloon — append a new balloon row at the end of the schedule
 *     with amount = -variance so the engine zeros out the residual.
 *   • Specific Line — pick any row and adjust its amount.
 *   • Ignore — accept the variance; close without changes.
 *
 * Sign convention: a negative ending balance means the loan is
 * overpaid; reducing the last payment by |variance| zeros it out.
 * A positive ending balance means underpaid; increasing the last
 * payment by |variance| zeros it.
 */
export function VarianceDialog({
  variance,
  rows,
  schedule,
  updateRow,
  insertRowAfter,
  onClose,
}: {
  variance: number;
  rows: GridRow[];
  schedule: ScheduleResult;
  updateRow: <K extends keyof GridRow>(rowId: string, key: K, value: GridRow[K]) => void;
  insertRowAfter: (rowId: string | null) => string;
  onClose: () => void;
}): JSX.Element {
  type Choice = "last-payment" | "balloon" | "specific" | "ignore";
  const [choice, setChoice] = useState<Choice>("last-payment");

  const paymentRows = rows
    .map((r, i) => ({ row: r, idx: i }))
    .filter(({ row }) => ["payment", "balloon", "fixed_principal"].includes(row.kind));
  const lastPaymentRow = paymentRows[paymentRows.length - 1];
  const [specificRowId, setSpecificRowId] = useState<string>(
    paymentRows[0]?.row.rowId ?? rows[0]?.rowId ?? "",
  );

  const lastEventDate =
    schedule.rows.length > 0
      ? (schedule.rows[schedule.rows.length - 1]!.date.toISOString().slice(0, 10) ?? "")
      : new Date().toISOString().slice(0, 10);

  const fmtVariance = `${variance > 0 ? "+" : ""}${variance.toFixed(2)}`;

  function applyLastPayment(): void {
    if (!lastPaymentRow) {
      toast.error("No payment row found to adjust.");
      return;
    }
    const r = lastPaymentRow.row;
    const count = Number(r.count) || 1;
    if (count > 1) {
      // Split: shrink the existing run by 1, then append a single
      // adjusted payment whose amount absorbs the variance. The
      // engine expands count + interval rows in chronological order,
      // so the new row fires after the shrunk series.
      const baseAmount = Number(r.amount) || 0;
      const adjustedLast = baseAmount - variance;
      updateRow(r.rowId, "count", String(count - 1));
      const newId = insertRowAfter(r.rowId);
      updateRow(newId, "kind", r.kind);
      updateRow(newId, "amount", adjustedLast.toFixed(2));
      updateRow(newId, "date", lastEventDate);
      updateRow(newId, "memo", "Adjusted last payment (variance resolution)");
    } else {
      const baseAmount = Number(r.amount) || 0;
      const adjustedLast = baseAmount - variance;
      updateRow(r.rowId, "amount", adjustedLast.toFixed(2));
    }
    toast.success(`Last payment adjusted by ${(-variance).toFixed(2)} to zero the balance.`);
    onClose();
  }

  function applyBalloon(): void {
    // Negative ending balance = overpaid → balloon refund.
    // Positive ending balance = underpaid → balloon top-up.
    // Either way, balloon amount = -variance (the engine treats a
    // balloon like a payment, signed by direction).
    const newId = insertRowAfter(null);
    updateRow(newId, "kind", "balloon");
    updateRow(newId, "amount", (-variance).toFixed(2));
    updateRow(newId, "date", lastEventDate);
    updateRow(newId, "memo", `Variance balloon (${fmtVariance})`);
    toast.success(`Balloon row added: ${(-variance).toFixed(2)}.`);
    onClose();
  }

  function applySpecific(): void {
    const target = rows.find((r) => r.rowId === specificRowId);
    if (!target) {
      toast.error("Pick a row first.");
      return;
    }
    const baseAmount = Number(target.amount) || 0;
    updateRow(specificRowId, "amount", (baseAmount - variance).toFixed(2));
    toast.success(
      `Adjusted row by ${(-variance).toFixed(2)}. New amount: ${(baseAmount - variance).toFixed(2)}.`,
    );
    onClose();
  }

  function apply(): void {
    if (choice === "last-payment") return applyLastPayment();
    if (choice === "balloon") return applyBalloon();
    if (choice === "specific") return applySpecific();
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="variance-title"
        className="w-full max-w-md rounded-md border border-border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="variance-title" className="text-lg font-semibold">
          Resolve variance
        </h2>
        <p className="mt-1 text-center text-2xl font-bold tabular-nums">{fmtVariance}</p>
        <p className="text-center text-xs text-muted-foreground">
          residual balance on {lastEventDate}
        </p>

        <p className="mt-4 text-sm font-medium">How do you want to account for this amount?</p>
        <ul className="mt-2 space-y-2 text-sm">
          <li>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                checked={choice === "last-payment"}
                onChange={() => setChoice("last-payment")}
                className="mt-1"
                disabled={!lastPaymentRow}
              />
              <span>
                <strong>Last Payment</strong>
                <span className="block text-xs text-muted-foreground">
                  Split the trailing series so the final sub-payment absorbs the variance.
                </span>
              </span>
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                checked={choice === "balloon"}
                onChange={() => setChoice("balloon")}
                className="mt-1"
              />
              <span>
                <strong>Balloon</strong>{" "}
                <span className="text-xs text-muted-foreground">(create an additional row)</span>
                <span className="block text-xs text-muted-foreground">
                  Adds a balloon row at {lastEventDate} for {(-variance).toFixed(2)}.
                </span>
              </span>
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                checked={choice === "specific"}
                onChange={() => setChoice("specific")}
                className="mt-1"
                disabled={rows.length === 0}
              />
              <span className="flex-1">
                <strong>Specific Line</strong>
                <select
                  value={specificRowId}
                  onChange={(e) => {
                    setSpecificRowId(e.target.value);
                    setChoice("specific");
                  }}
                  className="ml-2 rounded-md border border-input bg-background px-2 py-0.5 text-xs"
                >
                  {rows.map((r, i) => (
                    <option key={r.rowId} value={r.rowId}>
                      Line {i + 1}: {r.kind}
                      {r.amount ? ` (${r.amount})` : ""}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-muted-foreground">
                  Adjust the chosen row&apos;s amount by {(-variance).toFixed(2)}.
                </span>
              </span>
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                checked={choice === "ignore"}
                onChange={() => setChoice("ignore")}
                className="mt-1"
              />
              <span>
                <strong>Ignore</strong>
                <span className="block text-xs text-muted-foreground">
                  Accept the variance and close. The schedule is left as-is.
                </span>
              </span>
            </label>
          </li>
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
