import { and, desc, eq, isNull, lte, or, gt } from "drizzle-orm";
import {
  taxYearOverrides,
  taxYearTables,
  type TaxTableKind,
  type TaxYearTableRow,
  type TaxYearOverrideRow,
} from "./schema/tax-year-tables";
import type { Database } from "./connection";

/**
 * Phase 14 — runtime resolver.
 *
 * Picks the right (taxYear, kind) row for a given calculation date.
 *
 * Resolution order (Phase 14.7):
 *   1. tax_year_overrides matching (year, kind) and effective_from <= asOf
 *      and (effective_to IS NULL or effective_to >= asOf), most recent
 *      effective_from wins.
 *   2. tax_year_tables matching the same predicate, picking the live
 *      (non-superseded) row.
 *
 * Returns the matched row plus a `source` discriminator so the
 * calculator can record which IDs it consumed (Phase 14.4).
 */

export type ResolvedTaxRow =
  | { source: "override"; row: TaxYearOverrideRow }
  | { source: "table"; row: TaxYearTableRow }
  | null;

export async function resolveTaxRow(
  db: Database,
  taxYear: number,
  kind: TaxTableKind,
  asOf: Date = new Date(),
): Promise<ResolvedTaxRow> {
  // 1. Override lookup — wins if any matching row exists.
  const [override] = await db
    .select()
    .from(taxYearOverrides)
    .where(
      and(
        eq(taxYearOverrides.taxYear, taxYear),
        eq(taxYearOverrides.kind, kind),
        lte(taxYearOverrides.effectiveFrom, asOf),
        or(isNull(taxYearOverrides.effectiveTo), gt(taxYearOverrides.effectiveTo, asOf)),
      ),
    )
    .orderBy(desc(taxYearOverrides.effectiveFrom))
    .limit(1);
  if (override) return { source: "override", row: override };

  // 2. Live (non-superseded) row in tax_year_tables.
  const [row] = await db
    .select()
    .from(taxYearTables)
    .where(
      and(
        eq(taxYearTables.taxYear, taxYear),
        eq(taxYearTables.kind, kind),
        lte(taxYearTables.effectiveFrom, asOf),
        or(isNull(taxYearTables.effectiveTo), gt(taxYearTables.effectiveTo, asOf)),
        isNull(taxYearTables.supersededAt),
      ),
    )
    .orderBy(desc(taxYearTables.effectiveFrom))
    .limit(1);
  if (row) return { source: "table", row };

  return null;
}

/**
 * Bulk variant — resolves an array of (kind, asOf) lookups for the
 * same tax year. Used by the per-calculator `compute()` path so
 * each calc gets one round-trip rather than one per kind.
 */
export async function resolveTaxRows(
  db: Database,
  taxYear: number,
  lookups: { kind: TaxTableKind; asOf?: Date }[],
): Promise<Map<TaxTableKind, ResolvedTaxRow>> {
  const out = new Map<TaxTableKind, ResolvedTaxRow>();
  for (const l of lookups) {
    out.set(l.kind, await resolveTaxRow(db, taxYear, l.kind, l.asOf));
  }
  return out;
}
