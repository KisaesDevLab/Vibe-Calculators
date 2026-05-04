import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScheduleResult } from "@vibe-calc/calc-engine";

/**
 * Phase 12.6 — schedule charts.
 *
 * Three lightweight Recharts visualisations:
 *   - Principal-vs-interest stacked area over time
 *   - Remaining-balance curve
 *   - Cumulative-interest curve
 *
 * Caller picks which to render via the `kind` prop. Phase 12 ships
 * all three on a Tabs control inside the workbench schedule view.
 */

export type ChartKind = "stacked" | "balance" | "cumulative-interest";

interface DataPoint {
  date: string;
  principal: number;
  interest: number;
  closing: number;
  cumInterest: number;
}

export function ScheduleChart({
  schedule,
  kind,
  height = 240,
}: {
  schedule: ScheduleResult;
  kind: ChartKind;
  height?: number;
}): JSX.Element {
  const data = useMemo<DataPoint[]>(
    () =>
      schedule.rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        principal: r.principalApplied.toNumber(),
        interest: r.interestAccrued.toNumber(),
        closing: r.closing.toNumber(),
        cumInterest: r.cumulativeInterest.toNumber(),
      })),
    [schedule],
  );

  if (kind === "stacked") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="principal" stackId="1" stroke="#2563eb" fill="#2563eb" />
          <Area type="monotone" dataKey="interest" stackId="1" stroke="#dc2626" fill="#dc2626" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  if (kind === "balance") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="closing" stroke="#0f172a" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  // cumulative-interest
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="cumInterest" stroke="#dc2626" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Phase 12.8 — clipboard TSV export.
 *
 * Returns the schedule rows as TSV (header + rows). Caller does
 * navigator.clipboard.writeText(...).
 */
export function scheduleToTsv(schedule: ScheduleResult): string {
  const header = [
    "Date",
    "Event",
    "Opening",
    "Interest",
    "Payment",
    "Principal",
    "Closing",
    "Cumulative Interest",
    "Cumulative Principal",
    "Memo",
  ].join("\t");
  const rows = schedule.rows.map((r) =>
    [
      r.date.toISOString().slice(0, 10),
      r.kind,
      r.opening.toFixed(2),
      r.interestAccrued.toFixed(2),
      r.paymentApplied.toFixed(2),
      r.principalApplied.toFixed(2),
      r.closing.toFixed(2),
      r.cumulativeInterest.toFixed(2),
      r.cumulativePrincipal.toFixed(2),
      r.memo ?? "",
    ].join("\t"),
  );
  return [header, ...rows].join("\n");
}
