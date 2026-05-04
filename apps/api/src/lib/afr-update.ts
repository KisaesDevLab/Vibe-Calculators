import { eq, and } from "drizzle-orm";
import { taxYearTables, type Database } from "@vibe-calc/db";

/**
 * Phase 22.2 — AFR auto-update.
 *
 * The IRS publishes Applicable Federal Rates monthly via Rev. Rul.
 * For most CPA-advisory work the relevant rates are short, mid, and
 * long-term annual compounding values. This module supplies a
 * function that fetches the current month's IRS revenue ruling and
 * inserts a row into `tax_year_tables` keyed `afr_short_mid_long`.
 *
 * The fetcher is HTTP-only (no scraping); it pulls a JSON snapshot
 * from a configurable URL. In production the URL points at a
 * mirror maintained by us (the IRS doesn't publish JSON natively),
 * but the parser accepts the same shape regardless of source.
 *
 * For tests + offline mode, the module accepts a stubbed `fetcher`.
 */

export interface AfrPayload {
  shortTermAnnual: number;
  midTermAnnual: number;
  longTermAnnual: number;
  effectiveMonth: string; // YYYY-MM
  sourceUrl: string;
  sourceVersion: string;
}

export type AfrFetcher = (url: string) => Promise<AfrPayload>;

export const DEFAULT_AFR_URL =
  process.env.VIBE_AFR_FEED_URL ?? "https://api.vibecalc.local/afr/current";

/**
 * Fetch + insert. Returns the row id of the new tax_year_tables row.
 *
 * Idempotent: if a row already exists for this (taxYear, kind,
 * effectiveFrom), the function logs and returns the existing id.
 */
export async function syncAfr(
  db: Database,
  options: { fetcher?: AfrFetcher; url?: string; now?: Date } = {},
): Promise<{ inserted: boolean; id: string; payload: AfrPayload }> {
  const url = options.url ?? DEFAULT_AFR_URL;
  const fetcher = options.fetcher ?? defaultFetcher;
  const payload = await fetcher(url);

  const taxYear = Number.parseInt(payload.effectiveMonth.slice(0, 4), 10);
  const month = Number.parseInt(payload.effectiveMonth.slice(5, 7), 10);
  if (!Number.isFinite(taxYear) || !Number.isFinite(month)) {
    throw new Error(`Invalid effectiveMonth ${payload.effectiveMonth}`);
  }
  const effectiveFrom = new Date(Date.UTC(taxYear, month - 1, 1));

  const existing = await db
    .select({ id: taxYearTables.id })
    .from(taxYearTables)
    .where(
      and(
        eq(taxYearTables.taxYear, taxYear),
        eq(taxYearTables.kind, "afr_short_mid_long"),
        eq(taxYearTables.effectiveFrom, effectiveFrom),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { inserted: false, id: existing[0].id, payload };
  }

  const [row] = await db
    .insert(taxYearTables)
    .values({
      taxYear,
      kind: "afr_short_mid_long",
      effectiveFrom,
      payload: {
        shortTermAnnual: payload.shortTermAnnual,
        midTermAnnual: payload.midTermAnnual,
        longTermAnnual: payload.longTermAnnual,
      },
      sourceUrl: payload.sourceUrl,
      sourceVersion: payload.sourceVersion,
    })
    .returning({ id: taxYearTables.id });
  if (!row) throw new Error("AFR insert returned no row");
  return { inserted: true, id: row.id, payload };
}

const defaultFetcher: AfrFetcher = async (url: string) => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`AFR fetch failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as Partial<AfrPayload>;
  if (
    typeof json.shortTermAnnual !== "number" ||
    typeof json.midTermAnnual !== "number" ||
    typeof json.longTermAnnual !== "number" ||
    typeof json.effectiveMonth !== "string" ||
    typeof json.sourceUrl !== "string" ||
    typeof json.sourceVersion !== "string"
  ) {
    throw new Error("AFR feed missing required fields");
  }
  return json as AfrPayload;
};
