// Column widths of a report table (UMK-2117). Pure: the caller passes a `measure` that knows the fonts.
//
// One rule for every table: one line per cell. A `number` column (money, counts, a drawer difference) is as wide as
// its widest value and is never truncated; a `code` column (SKU, date, time) is as wide as its widest value up to a
// cap, then truncated; a `text` column (a name) takes what is left, at least its minimum, and is truncated with an
// ellipsis. When the numbers and the minimums do not fit, the font size steps down.

export type ColumnKind = 'text' | 'code' | 'number';

export interface LayoutColumn {
  label: string;
  kind: ColumnKind;
  /** Relative share of the room left over once every column has what it needs. */
  weight: number;
}

/** Width of `text` at font size `size`; `bold` is the face of the header and totals rows. */
export type Measure = (text: string, size: number, bold: boolean) => number;

export interface LayoutOptions {
  /** Left plus right padding of a cell, in pt. */
  pad: number;
  size: number;
  minSize: number;
  /** A code column is never wider than this many ems before it truncates. */
  codeCapEm?: number;
  /** The least a text column gets, in ems (less when its widest value is narrower). */
  textMinEm?: number;
}

export interface TableLayout {
  widths: number[];
  size: number;
}

const STEP = 0.5;

function attempt(
  cols: LayoutColumn[],
  rows: string[][],
  total: number,
  measure: Measure,
  o: Required<LayoutOptions>,
  size: number,
  boldFrom: number,
): number[] | null {
  const natural = cols.map((c, i) => {
    let w = measure(c.label, size, true);
    rows.forEach((r, k) => {
      w = Math.max(w, measure(r[i] ?? '', size, k >= boldFrom));
    });
    return w + o.pad;
  });
  // What each column must have, and what it would like.
  const need = cols.map((c, i) =>
    c.kind === 'number'
      ? natural[i]
      : Math.min(
          natural[i],
          (c.kind === 'code' ? o.codeCapEm : o.textMinEm) * size + o.pad,
        ),
  );
  const want = cols.map((c, i) => (c.kind === 'code' ? need[i] : natural[i]));
  const needed = need.reduce((a, b) => a + b, 0);
  if (needed > total + 1e-6) return null;
  const widths = [...need];
  // Text columns grow towards their natural width, shared by weight (water filling).
  let room = total - needed;
  let open = cols
    .map((c, i) => i)
    .filter((i) => cols[i].kind === 'text' && want[i] > widths[i]);
  while (room > 1e-6 && open.length > 0) {
    const sum = open.reduce((a, i) => a + cols[i].weight, 0);
    let used = 0;
    for (const i of open) {
      const give = Math.min((room * cols[i].weight) / sum, want[i] - widths[i]);
      widths[i] += give;
      used += give;
    }
    room -= used;
    open = open.filter((i) => want[i] - widths[i] > 1e-6);
    if (used <= 1e-9) break;
  }
  // What is still left is shared by every column, by weight, so a roomy table keeps its proportions.
  if (room > 1e-6) {
    const sum = cols.reduce((a, c) => a + c.weight, 0);
    cols.forEach((c, i) => (widths[i] += (room * c.weight) / sum));
  }
  return widths;
}

/**
 * The width of each column, summing to `total`, and the font size that lets every number fit. Rows from index
 * `boldFrom` on (totals) are measured bold.
 */
export function layoutColumns(
  cols: LayoutColumn[],
  rows: string[][],
  total: number,
  measure: Measure,
  opts: LayoutOptions,
  boldFrom = rows.length,
): TableLayout {
  const o: Required<LayoutOptions> = {
    codeCapEm: 14,
    textMinEm: 8,
    ...opts,
  };
  for (let size = o.size; size >= o.minSize - 1e-6; size -= STEP) {
    const widths = attempt(cols, rows, total, measure, o, size, boldFrom);
    if (widths) return { widths, size };
  }
  // Even the smallest size does not hold every number and minimum: numbers keep their width, the other columns
  // share what is left (and truncate).
  const size = o.minSize;
  const relaxed = { ...o, codeCapEm: 0, textMinEm: 0 };
  const widths = attempt(cols, rows, total, measure, relaxed, size, boldFrom);
  if (widths) return { widths, size };
  const sum = cols.reduce((a, c) => a + c.weight, 0);
  return { widths: cols.map((c) => (total * c.weight) / sum), size };
}

/**
 * The longest prefix of `text` (whole grapheme clusters, so a Thai or Devanagari mark is never split from its
 * letter) that, followed by an ellipsis, measures within `width`. `text` itself when it already fits.
 */
export function truncate(
  text: string,
  width: number,
  measure: (t: string) => number,
): string {
  // A column is exactly as wide as its widest value: compare with a hair of slack for floating point.
  const fits = (t: string) => measure(t) <= width + 1e-6;
  if (fits(text)) return text;
  const parts = graphemes(text);
  const fit = (n: number) => `${parts.slice(0, n).join('').trimEnd()}…`;
  let lo = 0;
  let hi = parts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(fit(mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 && !fits('…') ? '' : fit(lo);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string): string[] =>
  [...segmenter.segment(s.normalize('NFC'))].map((g) => g.segment);
