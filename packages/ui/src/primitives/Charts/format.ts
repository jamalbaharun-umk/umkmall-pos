import type { ChartUnit } from './vocab';

/**
 * Number formatting for charts, Indonesian style, integer arithmetic only.
 *
 * Money is integer rupiah everywhere in the POS. These helpers never call `toFixed`,
 * `Intl.NumberFormat` or `toLocaleString`: the output must be the same in the browser, on the
 * server and in the PDF renderer whatever the host locale is.
 */

const MINUS = '−';

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** `1234000` -> `1.234.000`, `-5` -> `-5` (a real minus sign). */
export function formatInt(n: number): string {
  const v = whole(n);
  return `${v < 0 ? MINUS : ''}${group(Math.abs(v))}`;
}

/** Full rupiah: `Rp1.234.000`, a negative amount `-Rp2.500` (minus sign U+2212). */
export function formatRupiah(n: number): string {
  const v = whole(n);
  return `${v < 0 ? MINUS : ''}Rp${group(Math.abs(v))}`;
}

const SHORT_UNITS = [
  { size: 1_000_000_000, suffix: ' M' },
  { size: 1_000_000, suffix: ' jt' },
  { size: 1_000, suffix: ' rb' },
] as const;

function shortNumber(abs: number): string {
  let i = SHORT_UNITS.findIndex((u) => abs >= u.size);
  if (i === -1) return group(abs);
  /* Two decimals, by integer arithmetic. 999.600 rounds to 1.000 rb, which reads better as 1 jt. */
  let hundredths = Math.round((abs * 100) / SHORT_UNITS[i].size);
  if (hundredths >= 100_000 && i > 0) {
    i -= 1;
    hundredths = Math.round((abs * 100) / SHORT_UNITS[i].size);
  }
  const intPart = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, '0').replace(/0$/, '');
  return `${group(intPart)}${frac === '0' || frac === '' ? '' : `,${frac}`}${SHORT_UNITS[i].suffix}`;
}

/** Short rupiah for axes and titles: `Rp1,35 jt`, `Rp350 rb`, `Rp2,1 M`, `Rp900`. */
export function formatRupiahShort(n: number): string {
  const v = whole(n);
  return `${v < 0 ? MINUS : ''}Rp${shortNumber(Math.abs(v))}`;
}

/** Short count for axes: `1,2 rb`, `350`. */
export function formatIntShort(n: number): string {
  const v = whole(n);
  return `${v < 0 ? MINUS : ''}${shortNumber(Math.abs(v))}`;
}

/** An integer percent: `11%`. */
export function formatPercent(n: number): string {
  return `${formatInt(n)}%`;
}

/** Percent of `part` in `total`, rounded to an integer. `0` when the total is not positive. */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part * 100) / total) : 0;
}

export type { ChartUnit };

export interface UnitFormats {
  /** Full value: tooltips, legends, tables. */
  full: (n: number) => string;
  /** Short value: axes and titles only. */
  short: (n: number) => string;
}

export const UNIT_FORMATS: Record<ChartUnit, UnitFormats> = {
  count: { full: formatInt, short: formatIntShort },
  rupiah: { full: formatRupiah, short: formatRupiahShort },
  percent: { full: formatPercent, short: formatPercent },
};

export function resolveFormats(
  unit: ChartUnit | undefined,
  valueFormat?: (n: number) => string,
  axisFormat?: (n: number) => string,
): UnitFormats {
  const base = UNIT_FORMATS[unit ?? 'count'];
  const full = valueFormat ?? base.full;
  return { full, short: axisFormat ?? (valueFormat ? valueFormat : base.short) };
}

/** Rough text width in px, for layout only (labels are clipped by this, never measured in a DOM). */
export function textWidth(s: string, fontPx = 12): number {
  return Math.ceil(s.length * fontPx * 0.6);
}

/** Cuts a label to fit `maxPx`, with an ellipsis. */
export function truncate(s: string, maxPx: number, fontPx = 12): string {
  if (textWidth(s, fontPx) <= maxPx) return s;
  const keep = Math.max(1, Math.floor(maxPx / (fontPx * 0.6)) - 1);
  return `${s.slice(0, keep)}…`;
}
