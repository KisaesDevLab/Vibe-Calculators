import Decimal from "decimal.js";
import type { TaxTableKind } from "@vibe-calc/db";

/**
 * Shared helpers for applying federal bracket schedules.
 *
 * All percentages stored as decimals (0.22 = 22%).
 */

export interface BracketRow {
  rate: number;
  upto: number | null;
}

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qss";

interface BracketsPayload {
  single: BracketRow[];
  mfj: BracketRow[];
  mfs: BracketRow[];
  hoh: BracketRow[];
  qw?: BracketRow[];
}

interface ResolvedTableRow {
  source: "table" | "override";
  row: { payload: unknown };
}

const FALLBACK_2024: BracketsPayload = {
  single: [
    { rate: 0.1, upto: 11600 },
    { rate: 0.12, upto: 47150 },
    { rate: 0.22, upto: 100525 },
    { rate: 0.24, upto: 191950 },
    { rate: 0.32, upto: 243725 },
    { rate: 0.35, upto: 609350 },
    { rate: 0.37, upto: null },
  ],
  mfj: [
    { rate: 0.1, upto: 23200 },
    { rate: 0.12, upto: 94300 },
    { rate: 0.22, upto: 201050 },
    { rate: 0.24, upto: 383900 },
    { rate: 0.32, upto: 487450 },
    { rate: 0.35, upto: 731200 },
    { rate: 0.37, upto: null },
  ],
  mfs: [
    { rate: 0.1, upto: 11600 },
    { rate: 0.12, upto: 47150 },
    { rate: 0.22, upto: 100525 },
    { rate: 0.24, upto: 191950 },
    { rate: 0.32, upto: 243725 },
    { rate: 0.35, upto: 365600 },
    { rate: 0.37, upto: null },
  ],
  hoh: [
    { rate: 0.1, upto: 16550 },
    { rate: 0.12, upto: 63100 },
    { rate: 0.22, upto: 100500 },
    { rate: 0.24, upto: 191950 },
    { rate: 0.32, upto: 243700 },
    { rate: 0.35, upto: 609350 },
    { rate: 0.37, upto: null },
  ],
};

const FALLBACK_2025: BracketsPayload = {
  single: [
    { rate: 0.1, upto: 11925 },
    { rate: 0.12, upto: 48475 },
    { rate: 0.22, upto: 103350 },
    { rate: 0.24, upto: 197300 },
    { rate: 0.32, upto: 250525 },
    { rate: 0.35, upto: 626350 },
    { rate: 0.37, upto: null },
  ],
  mfj: [
    { rate: 0.1, upto: 23850 },
    { rate: 0.12, upto: 96950 },
    { rate: 0.22, upto: 206700 },
    { rate: 0.24, upto: 394600 },
    { rate: 0.32, upto: 501050 },
    { rate: 0.35, upto: 751600 },
    { rate: 0.37, upto: null },
  ],
  mfs: [
    { rate: 0.1, upto: 11925 },
    { rate: 0.12, upto: 48475 },
    { rate: 0.22, upto: 103350 },
    { rate: 0.24, upto: 197300 },
    { rate: 0.32, upto: 250525 },
    { rate: 0.35, upto: 375800 },
    { rate: 0.37, upto: null },
  ],
  hoh: [
    { rate: 0.1, upto: 17000 },
    { rate: 0.12, upto: 64850 },
    { rate: 0.22, upto: 103350 },
    { rate: 0.24, upto: 197300 },
    { rate: 0.32, upto: 250500 },
    { rate: 0.35, upto: 626350 },
    { rate: 0.37, upto: null },
  ],
};

function isBracketsPayload(v: unknown): v is BracketsPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    "single" in v &&
    Array.isArray((v as { single: unknown }).single)
  );
}

export function readBrackets(
  ctx: { tables: Map<TaxTableKind, unknown> },
  taxYear: number,
): BracketsPayload {
  const row = ctx.tables.get("federal_tax_brackets") as ResolvedTableRow | null | undefined;
  if (row && isBracketsPayload(row.row.payload)) return row.row.payload;
  if (taxYear === 2024) return FALLBACK_2024;
  if (taxYear === 2025) return FALLBACK_2025;
  throw new Error(`No federal_tax_brackets fallback for tax year ${taxYear}`);
}

/**
 * Apply a progressive bracket schedule. Returns the total tax.
 */
export function applyBrackets(taxableIncome: number, brackets: BracketRow[]): number {
  let remaining = new Decimal(taxableIncome);
  let prev = new Decimal(0);
  let tax = new Decimal(0);
  for (const b of brackets) {
    if (remaining.lte(0)) break;
    const top = b.upto === null ? Decimal.add(taxableIncome, 1) : new Decimal(b.upto);
    const span = top.minus(prev);
    const taxedHere = Decimal.min(remaining, span);
    tax = tax.plus(taxedHere.times(b.rate));
    remaining = remaining.minus(taxedHere);
    prev = top;
  }
  return tax.toDecimalPlaces(2).toNumber();
}

/**
 * Marginal bracket rate at a given taxable income.
 */
export function marginalRate(taxableIncome: number, brackets: BracketRow[]): number {
  for (const b of brackets) {
    if (b.upto === null || taxableIncome <= b.upto) return b.rate;
  }
  return brackets[brackets.length - 1]?.rate ?? 0;
}

export function bracketsForStatus(payload: BracketsPayload, status: FilingStatus): BracketRow[] {
  if (status === "qss") return payload.qw ?? payload.mfj;
  return payload[status];
}
