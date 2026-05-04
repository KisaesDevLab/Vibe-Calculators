/**
 * Pub 590-B Appendix B — RMD lifetime tables (post-2022 update).
 *
 * Source: 87 FR 59110 (Treasury Decision 9930, Final Regs Nov 2020,
 * applicable for distributions calculated for years beginning on or
 * after Jan 1, 2022).
 *
 * Tables are largely invariant year-over-year; future updates would
 * be unusual.
 */

/**
 * Uniform Lifetime Table (Table III in Pub 590-B). Used by most
 * account owners. Key = age at end of distribution year.
 */
export const UNIFORM_LIFETIME: Record<number, number> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
};

/**
 * Single Life Table (Table I in Pub 590-B). Used by inherited-IRA
 * beneficiaries who qualify as eligible designated beneficiaries
 * (EDBs) under SECURE Act.
 *
 * Truncated to common ages; full table runs 0-120.
 */
export const SINGLE_LIFE: Record<number, number> = {
  30: 55.3,
  35: 50.5,
  40: 45.7,
  45: 41.0,
  50: 36.2,
  55: 31.6,
  60: 27.1,
  65: 22.9,
  70: 18.8,
  75: 14.8,
  80: 11.2,
  85: 8.1,
  90: 5.7,
};

/**
 * SECURE 2.0 RMD start ages.
 *
 *   - Age 72: pre-SECURE 2.0 (death-clock pre-2023)
 *   - Age 73: applies to those born 1951-1959 (SECURE 2.0 §107)
 *   - Age 75: applies to those born 1960 or later (SECURE 2.0 §107)
 */
export function rmdStartAge(birthYear: number): 72 | 73 | 75 {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

/**
 * Look up Uniform Lifetime divisor; clamps to oldest published age.
 */
export function uniformLifetimeDivisor(age: number): number {
  if (age < 72) throw new Error(`No RMD divisor for age ${age} (Uniform Lifetime starts at 72)`);
  if (age >= 120) {
    const v = UNIFORM_LIFETIME[120];
    if (v === undefined) throw new Error("unreachable");
    return v;
  }
  const v = UNIFORM_LIFETIME[age];
  if (v === undefined) throw new Error(`Missing UNIFORM_LIFETIME entry for age ${age}`);
  return v;
}

const SINGLE_LIFE_AGES_SORTED: readonly number[] = [
  30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
];

/**
 * Look up Single Life divisor with linear interpolation between
 * the published 5-year increments. Acceptable for advisory use; for
 * actual RMD reporting, the IRS publishes the full table.
 */
export function singleLifeDivisor(age: number): number {
  const exact = SINGLE_LIFE[age];
  if (exact !== undefined) return exact;
  const ages = SINGLE_LIFE_AGES_SORTED;
  for (let i = 0; i < ages.length - 1; i++) {
    const a0 = ages[i];
    const a1 = ages[i + 1];
    if (a0 !== undefined && a1 !== undefined && a0 <= age && age < a1) {
      const v0 = SINGLE_LIFE[a0];
      const v1 = SINGLE_LIFE[a1];
      if (v0 === undefined || v1 === undefined) throw new Error("unreachable");
      const span = a1 - a0;
      const t = (age - a0) / span;
      return v0 + (v1 - v0) * t;
    }
  }
  const first = ages[0];
  const last = ages[ages.length - 1];
  if (first !== undefined && age < first) {
    const v = SINGLE_LIFE[first];
    if (v === undefined) throw new Error("unreachable");
    return v;
  }
  if (last !== undefined) {
    const v = SINGLE_LIFE[last];
    if (v === undefined) throw new Error("unreachable");
    return v;
  }
  throw new Error("unreachable");
}
