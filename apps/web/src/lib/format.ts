/**
 * Phase 13.2 — shared number formatting for schedule output.
 *
 * Every monetary cell in the workbench, in the inline schedule, and
 * in PDF/CSV/XLSX templates uses this helper to produce
 * thousand-separated, 2-decimal output ("150,000.07"). Negative
 * values render with a leading minus.
 *
 * The argument is intentionally typed as the minimal interface
 * that decimal.js's Decimal exposes — `toFixed(n)` — so this
 * function works equally for plain numbers and Decimal instances
 * without importing decimal.js into the web bundle just for the
 * formatter.
 */
export function fmtMoney(
  d: { toFixed(n: number): string } | number | string | null | undefined,
): string {
  if (d === null || d === undefined) return "—";
  let raw: string;
  if (typeof d === "number") {
    if (!Number.isFinite(d)) return String(d);
    raw = d.toFixed(2);
  } else if (typeof d === "string") {
    const n = Number(d);
    if (!Number.isFinite(n)) return d;
    raw = n.toFixed(2);
  } else {
    raw = d.toFixed(2);
  }
  // raw is "-150000.07" or "150000.07". Split on decimal, group the
  // integer side with commas, reassemble.
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole, frac] = body.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac ?? "00"}`;
}
