import type { ScheduleResult } from "@vibe-calc/calc-engine";

/**
 * Phase 13.5 — RFC-4180 CSV export.
 *
 * - UTF-8; optional BOM toggle for Excel-on-Windows so the file
 *   opens with the right encoding without manual import wizardry.
 * - Fields containing comma / quote / newline are quoted; embedded
 *   quotes are doubled.
 */

export interface CsvOptions {
  /** Prepend the UTF-8 BOM. Default false. */
  bom?: boolean;
  /** Field separator. Default ','. */
  delimiter?: "," | ";" | "\t";
  /** Line terminator. Default '\r\n' per RFC 4180. */
  newline?: "\r\n" | "\n";
}

/**
 * CSV-injection guard — Excel and other spreadsheets evaluate any
 * cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` as a formula.
 * Untrusted user input could embed `=HYPERLINK(...)`, `=cmd|...`,
 * etc. We prefix dangerous-looking values with a single quote so the
 * spreadsheet renders the value literally instead of evaluating it.
 */
function sanitizeCellForCsv(value: string): string {
  if (value.length === 0) return value;
  const first = value.charCodeAt(0);
  // = + - @ \t \r
  if (
    first === 0x3d ||
    first === 0x2b ||
    first === 0x2d ||
    first === 0x40 ||
    first === 0x09 ||
    first === 0x0d
  ) {
    return `'${value}`;
  }
  return value;
}

export function escapeCsv(value: string, delimiter = ","): string {
  const safe = sanitizeCellForCsv(value);
  if (
    safe.includes(delimiter) ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function rowsToCsv(rows: readonly string[][], opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ",";
  const newline = opts.newline ?? "\r\n";
  const body = rows
    .map((row) => row.map((cell) => escapeCsv(cell, delimiter)).join(delimiter))
    .join(newline);
  const bom = opts.bom ? "﻿" : "";
  return bom + body;
}

/** Convert a calc-engine ScheduleResult to a CSV string. */
export function scheduleToCsv(schedule: ScheduleResult, opts?: CsvOptions): string {
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
  ];
  const rows: string[][] = [header];
  for (const r of schedule.rows) {
    rows.push([
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
    ]);
  }
  return rowsToCsv(rows, opts);
}
