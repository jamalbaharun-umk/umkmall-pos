// The visuals of the reports (design features 37 and 38), as data. pos-api computes every figure and sends this
// shape; the screen draws it with `@umkmall/ui` Charts and the PDF draws it with the same components
// (`pdf/chart-render.ts`), so the two cannot disagree. Integer rupiah (or counts), never floats.

export type VisualUnit = 'rupiah' | 'count';
/** Fixed colour slot of the chart standard: 1 = primary blue, 2 = dark blue, 3 = light blue, 4 = grey. */
export type VisualSlot = 1 | 2 | 3 | 4 | 'other' | 'neg';

interface VisualBase {
  /** Stable key, e.g. `trend-harian`. */
  id: string;
  title: string;
  unit: VisualUnit;
  /** Heading of the table twin's first column. */
  categoryLabel?: string;
}

/** Columns (vertical) or bars (horizontal); one series, two grouped, or any number stacked. */
export interface BarsVisual extends VisualBase {
  kind: 'bars';
  orientation: 'vertical' | 'horizontal';
  categories: string[];
  series: Array<{ label: string; values: number[]; color?: VisualSlot }>;
  stacked?: boolean;
}

/** One bar cut into parts (payment method, ageing). `sequential` for ordered data such as an ageing. */
export interface SegmentsVisual extends VisualBase {
  kind: 'segments';
  palette?: 'categorical' | 'sequential';
  parts: Array<{ label: string; value: number }>;
}

export type Visual = BarsVisual | SegmentsVisual;

/** A visual with nothing to draw: every value is zero, or there are no categories. Screens say "Belum ada data". */
export function visualIsEmpty(v: Visual): boolean {
  return v.kind === 'bars'
    ? v.categories.length === 0 ||
        v.series.every((s) => s.values.every((x) => x === 0))
    : v.parts.every((p) => p.value <= 0);
}
