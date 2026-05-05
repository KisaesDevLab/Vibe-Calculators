/**
 * Phase 13.2 — comma-grouped money formatter shared across every
 * PDF template in this package. Accepts decimal.js Decimals (via
 * the duck-typed `toFixed` interface), plain numbers, and strings.
 *
 * Output: "150,000.07" / "-150,000.07" / "0.00".
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
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole, frac] = body.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac ?? "00"}`;
}
