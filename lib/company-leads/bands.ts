/**
 * Company size bands shared with Wayo Ads.
 *
 * The CSV dumps store `salesVolume` and `employeeCount` as free-form text
 * ("1 - 4", "$1 Million to $2.5 Million", "500,000", "1,000+"), so the band is
 * derived ONCE at import and persisted as a small int. Queries then filter on a
 * cheap integer instead of re-parsing 50k strings on every request.
 *
 * 0 = MICRO, 1 = MID, 2 = MACRO, 3 = MEGA. `null` means "not derivable" — such
 * rows are dropped from every proposal: without a size there is no way to match
 * them to a channel's reach.
 */

/** Upper bound (inclusive) of each band; MEGA is open-ended. */
export const EMPLOYEE_BAND_CEILINGS = [10, 100, 1_000, Number.POSITIVE_INFINITY] as const;
export const REVENUE_BAND_CEILINGS = [1_000_000, 10_000_000, 100_000_000, Number.POSITIVE_INFINITY] as const;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  thousands: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  mn: 1_000_000,
  million: 1_000_000,
  millions: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
  billions: 1_000_000_000,
};

/** Below this the value is an upper bound, not an estimate → halve it. */
const UNDER_RE = /\b(under|less than|below|up to|fewer than)\b/i;
/** Above this the value is a floor, not an estimate → keep it. */
const OVER_RE = /\b(over|more than|above|at least|\+)\b/i;

/**
 * Pull a single representative number out of a free-form size cell.
 * Ranges become their midpoint; "under X" halves X; "over X" keeps X.
 */
export function parseSizeValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw
    .toLowerCase()
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\$/g, ' ')
    .trim();
  if (!text) return null;

  const scaled: number[] = [];

  // Word/suffix multipliers first: "1.5 million" → 1500000, "250k" → 250000.
  const suffixRe = /(\d[\d.,]*)\s*(thousand|thousands|million|millions|billion|billions|mm|mn|bn|k|m|b)\b/g;
  let match: RegExpExecArray | null;
  while ((match = suffixRe.exec(text)) !== null) {
    const value = toNumber(match[1]);
    const factor = MULTIPLIERS[match[2]];
    if (value != null && factor) scaled.push(value * factor);
  }
  const rest = text.replace(suffixRe, ' ');

  // Bare numbers: "500,000", "1 - 4", "1000+".
  for (const token of rest.match(/\d[\d.,]*/g) ?? []) {
    const value = toNumber(token);
    if (value != null) scaled.push(value);
  }

  const usable = scaled.filter((n) => Number.isFinite(n) && n >= 0);
  if (usable.length === 0) return null;

  const min = Math.min(...usable);
  const max = Math.max(...usable);
  let estimate = (min + max) / 2;

  if (usable.length === 1 && UNDER_RE.test(text)) estimate /= 2;
  // "over X" / "X+" already is the floor: keep the number as the estimate.
  if (usable.length === 1 && OVER_RE.test(text)) estimate = usable[0];

  return Math.round(estimate);
}

function toNumber(token: string): number | null {
  const cleaned = token.replace(/,/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Index of the first ceiling the value fits under.
 *
 * `inclusive` follows how the source ranges read: employee ranges are closed
 * ("1 - 4", "11 - 100") so 10 employees is still MICRO, while revenue bands are
 * written as thresholds ("$1 Million +") so exactly $1M is already MID.
 */
export function bandIndexFromValue(
  value: number | null,
  ceilings: readonly number[],
  inclusive = true,
): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  for (let i = 0; i < ceilings.length; i += 1) {
    const ceiling = ceilings[i]!;
    if (inclusive ? value <= ceiling : value < ceiling) return i;
  }
  return ceilings.length - 1;
}

export function employeeBand(raw: string | null | undefined): number | null {
  return bandIndexFromValue(parseSizeValue(raw), EMPLOYEE_BAND_CEILINGS, true);
}

export function revenueBand(raw: string | null | undefined): number | null {
  return bandIndexFromValue(parseSizeValue(raw), REVENUE_BAND_CEILINGS, false);
}

/**
 * An unknown band is `null`, never MICRO — treating "we don't know" as "small"
 * would quietly bury real companies at the bottom of every list.
 */
export function companyBand(
  employees: string | null | undefined,
  revenue: string | null | undefined,
): number | null {
  const e = employeeBand(employees);
  const r = revenueBand(revenue);
  if (e == null && r == null) return null;
  return Math.max(e ?? 0, r ?? 0);
}
