import { useMemo, useRef } from "react";
import type { ScheduleResult, ScheduleSubtotal } from "@vibe-calc/calc-engine";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";

// Discriminator for the unified item list — schedule rows mixed with
// subtotal markers, virtualized as a single sequence.
type Item = { type: "row"; rowIdx: number } | { type: "subtotal"; subtotal: ScheduleSubtotal };

/**
 * Phase 11.7 — schedule virtualization.
 *
 * For schedules ≤ 500 rows the standard `<table>` renders fine. Above
 * that — a 30-year daily-compounding schedule clocks in at ~10,950
 * rows — naive rendering janks the page. This component windows the
 * rows via @tanstack/react-virtual: only the rows in / near the
 * viewport are mounted; the rest are absolutely-positioned spacer
 * offsets.
 *
 * We fall back to a single-table render when the row count is small
 * enough that virtualization adds no value but does cost a layer of
 * indirection. The threshold is consumed by the workbench.
 */

export const VIRTUALIZE_THRESHOLD = 500;

export function VirtualScheduleTable({
  schedule,
  rowAnnotations,
  setRowAnnotation,
  deriveMathTooltip,
  isYearEnd,
  subtotals = [],
}: {
  schedule: ScheduleResult;
  rowAnnotations: Record<string, string>;
  setRowAnnotation: (dateKey: string, note: string) => void;
  deriveMathTooltip: (row: ScheduleResult["rows"][number]) => string;
  isYearEnd: (date: Date) => boolean;
  /** Phase 13.2 — optional inline subtotal markers. */
  subtotals?: ScheduleSubtotal[];
}): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);

  // Interleave subtotal markers into the row sequence so the virtual
  // list sees one flat array of items.
  const items: Item[] = useMemo(() => {
    const subtotalsByIdx = new Map<number, ScheduleSubtotal[]>();
    for (const s of subtotals) {
      const arr = subtotalsByIdx.get(s.afterRowIndex) ?? [];
      arr.push(s);
      subtotalsByIdx.set(s.afterRowIndex, arr);
    }
    const out: Item[] = [];
    for (let i = 0; i < schedule.rows.length; i++) {
      out.push({ type: "row", rowIdx: i });
      const after = subtotalsByIdx.get(i);
      if (after) for (const s of after) out.push({ type: "subtotal", subtotal: s });
    }
    return out;
  }, [schedule.rows, subtotals]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 16,
  });

  return (
    <div className="rounded-md border border-border">
      {/* Sticky header — outside the scroll container so it stays put. */}
      <div className="sticky top-0 z-10 grid grid-cols-[110px_110px_1fr_1fr_1fr_1fr_1fr_1fr_2fr] gap-2 border-b border-border bg-muted/50 px-2 py-1 text-left text-xs font-mono uppercase tracking-wide">
        <div>Date</div>
        <div>Event</div>
        <div className="text-right">Opening</div>
        <div className="text-right">Interest</div>
        <div className="text-right">Payment</div>
        <div className="text-right">Principal</div>
        <div className="text-right">Closing</div>
        <div className="text-right">Cum. int.</div>
        <div>Memo</div>
      </div>

      <div
        ref={parentRef}
        className="relative max-h-[60vh] overflow-y-auto"
        // height capped at 60vh; the inner div drives total height.
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((vrow) => {
            const item = items[vrow.index];
            if (!item) return null;
            if (item.type === "subtotal") {
              const s = item.subtotal;
              const isGrand = s.label === "Grand Total";
              return (
                <div
                  key={vrow.key}
                  className={cn(
                    "absolute left-0 right-0 grid grid-cols-[110px_110px_1fr_1fr_1fr_1fr_1fr_1fr_2fr] gap-2 px-2 py-1 text-xs font-mono font-semibold",
                    isGrand
                      ? "border-y-2 border-foreground bg-secondary/80"
                      : "border-y border-border bg-secondary/40",
                  )}
                  style={{
                    top: 0,
                    height: `${vrow.size}px`,
                    transform: `translateY(${vrow.start}px)`,
                  }}
                >
                  <div className="col-span-2">{s.label}</div>
                  <div className="text-right text-muted-foreground">—</div>
                  <div className="text-right">{fmtMoney(s.totalInterest)}</div>
                  <div className="text-right">{fmtMoney(s.totalPayment)}</div>
                  <div className="text-right">{fmtMoney(s.totalPrincipal)}</div>
                  <div className="text-right text-muted-foreground">—</div>
                  <div className="text-right text-muted-foreground">—</div>
                  <div></div>
                </div>
              );
            }
            const r = schedule.rows[item.rowIdx];
            if (!r) return null;
            const dateKey = r.date.toISOString().slice(0, 10);
            const annotation = rowAnnotations[dateKey] ?? "";
            const yearEnd = isYearEnd(r.date);
            const math = deriveMathTooltip(r);
            return (
              <div
                key={vrow.key}
                title={math}
                className={cn(
                  "absolute left-0 right-0 grid cursor-help grid-cols-[110px_110px_1fr_1fr_1fr_1fr_1fr_1fr_2fr] gap-2 border-b border-border/50 px-2 py-1 text-xs font-mono",
                  r.negativeAm && "bg-destructive/5",
                  yearEnd && "bg-secondary/40 font-semibold",
                )}
                style={{
                  top: 0,
                  height: `${vrow.size}px`,
                  transform: `translateY(${vrow.start}px)`,
                }}
              >
                <div>{dateKey}</div>
                <div>{r.kind}</div>
                <div className="text-right">{fmtMoney(r.opening)}</div>
                <div className="text-right">{fmtMoney(r.interestAccrued)}</div>
                <div className="text-right">{fmtMoney(r.paymentApplied)}</div>
                <div className="text-right">{fmtMoney(r.principalApplied)}</div>
                <div className="text-right">{fmtMoney(r.closing)}</div>
                <div className="text-right">{fmtMoney(r.cumulativeInterest)}</div>
                <div className="max-w-full truncate" title={annotation || r.memo || ""}>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-1 hover:bg-accent/40",
                      annotation && "text-primary font-semibold",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = window.prompt(
                        `Annotation for ${dateKey} (saved with version):`,
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="border-t border-border/50 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
        {schedule.rows.length.toLocaleString()} rows · windowed render. Print stylesheet uses the
        unvirtualized table.
      </p>
    </div>
  );
}
