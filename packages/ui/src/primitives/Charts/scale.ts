/** Scale and layout maths for the charts. Pure functions: same input, same output, no DOM. */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export interface Domain {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * A "nice" zero-based domain. Bars start at zero, so the domain always includes 0.
 * Steps are 1, 2 or 5 times a power of ten and never below 1: the data is integer
 * (rupiah or counts), so a tick is never a fraction.
 */
export function niceDomain(minValue: number, maxValue: number, count = 4): Domain {
  const lo = Math.min(0, minValue);
  let hi = Math.max(0, maxValue);
  if (hi === lo) hi = lo + 1;
  const rough = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, mult * mag);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, step, ticks };
}

/** Maps a value of `[d0, d1]` onto `[r0, r1]` (the range may run backwards). */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

export interface Bands {
  step: number;
  bandwidth: number;
  start: (i: number) => number;
}

/** `n` equal bands over `total` px; `padding` is the share of a step left empty between bands. */
export function bands(n: number, total: number, padding = 0.3): Bands {
  const step = n > 0 ? total / n : total;
  const bandwidth = step * (1 - padding);
  return { step, bandwidth, start: (i) => i * step + (step - bandwidth) / 2 };
}

/** Integer percentages that add up to exactly 100 (largest remainder). All zeros for a zero total. */
export function percents(values: number[]): number[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) * 100) / total);
  const base = raw.map(Math.floor);
  let left = 100 - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

export interface PartInput {
  label: string;
  value: number;
}

export interface Slice extends PartInput {
  /** Share of the total, integer percent; the shares add up to 100. */
  percent: number;
  /** Where the slice starts, in percent of the ring (0 to 100). */
  start: number;
  /** Its length, in percent of the ring. */
  length: number;
  /** True for the merged "Lainnya" part. */
  merged: boolean;
  /** Position in the input, or -1 for the merged part. */
  index: number;
}

export const OTHER_LABEL = 'Lainnya';

/**
 * Orders parts from the largest and folds the tail into "Lainnya" so at most `max` remain.
 * Parts with no value are dropped. The merged part always comes last.
 */
export function toSlices(parts: PartInput[], max = 5, otherLabel = OTHER_LABEL): Slice[] {
  const positive = parts
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);
  let kept: Array<PartInput & { index: number; merged: boolean }> = positive.map((p) => ({ ...p, merged: false }));
  if (positive.length > max) {
    const head = positive.slice(0, max - 1).map((p) => ({ ...p, merged: false }));
    const rest = positive.slice(max - 1);
    kept = [...head, { label: otherLabel, value: rest.reduce((a, p) => a + p.value, 0), index: -1, merged: true }];
  }
  const total = kept.reduce((a, p) => a + p.value, 0);
  const pct = percents(kept.map((p) => p.value));
  let at = 0;
  return kept.map((p, i) => {
    const length = total > 0 ? (p.value * 100) / total : 0;
    const slice: Slice = { ...p, percent: pct[i], start: at, length };
    at += length;
    return slice;
  });
}

export interface Segment {
  x: number;
  width: number;
}

/**
 * Lays segments side by side in `width` px with `gap` px between them. A segment with a value is
 * never thinner than `minWidth`, so a small part is still visible; the others give up the room.
 * A part with no value gets no segment (`width` 0).
 */
export function layoutSegments(values: number[], width: number, gap = 2, minWidth = 4): Segment[] {
  const live = values.map((v) => Math.max(0, v));
  const count = live.filter((v) => v > 0).length;
  const total = live.reduce((a, b) => a + b, 0);
  if (count === 0 || total <= 0) return live.map(() => ({ x: 0, width: 0 }));
  const room = Math.max(0, width - gap * (count - 1));
  const widths = live.map((v) => (v > 0 ? (v / total) * room : 0));
  const pinned = widths.map((w, i) => live[i] > 0 && w < minWidth);
  const pinnedSum = pinned.reduce((a, p) => a + (p ? minWidth : 0), 0);
  const freeValue = live.reduce((a, v, i) => a + (v > 0 && !pinned[i] ? v : 0), 0);
  const freeRoom = Math.max(0, room - pinnedSum);
  const final = widths.map((w, i) => (live[i] <= 0 ? 0 : pinned[i] ? minWidth : freeValue > 0 ? (live[i] / freeValue) * freeRoom : w));
  let x = 0;
  return final.map((w) => {
    const seg = { x, width: w };
    if (w > 0) x += w + gap;
    return seg;
  });
}

/** Step 0 for no value, then 1 to `levels` by share of `max`. */
export function heatLevel(value: number, max: number, levels = 5): number {
  if (value <= 0 || max <= 0) return 0;
  return clamp(Math.ceil((value / max) * levels), 1, levels);
}

/** Picks `n` of `steps` ramp steps spread evenly (1-based), for ordered data such as ageing. */
export function sequentialSteps(n: number, steps = 5): number[] {
  if (n <= 1) return n === 1 ? [steps] : [];
  return Array.from({ length: n }, (_, i) => Math.round((i * (steps - 1)) / (n - 1)) + 1);
}

/** Every k-th label so labels do not touch: the k that keeps `labelPx` clear in `stepPx`. */
export function labelStride(labelPx: number, stepPx: number): number {
  return Math.max(1, Math.ceil((labelPx + 6) / Math.max(1, stepPx)));
}

export function polyline(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
}

/** One decimal place, as a number: keeps the markup short and identical on every machine. */
export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Three decimal places, as a number (dash lengths on a 100-long ring). */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function areaPath(points: Array<[number, number]>, baseline: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `M${r1(first[0])},${r1(baseline)} L${points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L')} L${r1(last[0])},${r1(baseline)} Z`;
}
