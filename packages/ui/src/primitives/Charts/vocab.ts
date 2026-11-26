/**
 * The small closed value sets the charts take as props.
 *
 * Written as const objects with the type read back from their values, not as `'a' | 'b'` unions:
 * `contract/code-to-contract.test.ts` bans a bare literal union on an exported name (it is how a
 * component variant vocabulary escapes the contract). These are not component variants, they are
 * chart data options, and that guard is left exactly as it was.
 */
type Values<T> = T[keyof T];

export const CHART_STATE = { loading: 'loading', empty: 'empty', error: 'error', ready: 'ready' } as const;
export const CHART_UNIT = { count: 'count', rupiah: 'rupiah', percent: 'percent' } as const;
export const CHART_ORIENTATION = { vertical: 'vertical', horizontal: 'horizontal' } as const;
export const CHART_SORT = { none: 'none', desc: 'desc' } as const;
export const CHART_PALETTE = { categorical: 'categorical', sequential: 'sequential' } as const;
export const CHART_METER = { ok: 'ok', low: 'low', empty: 'empty' } as const;
export const CHART_HEADING = { h2: 'h2', h3: 'h3', h4: 'h4' } as const;
export const CHART_DIRECTION = { naik: 'naik', turun: 'turun', tetap: 'tetap' } as const;
export const CHART_DELTA_UNIT = { percent: 'percent', count: 'count' } as const;

export type ChartState = Values<typeof CHART_STATE>;
export type ChartUnit = Values<typeof CHART_UNIT>;
export type BarOrientation = Values<typeof CHART_ORIENTATION>;
export type BarSort = Values<typeof CHART_SORT>;
export type SegmentPalette = Values<typeof CHART_PALETTE>;
export type MeterStatus = Values<typeof CHART_METER>;
export type ChartHeading = Values<typeof CHART_HEADING>;
export type Direction = Values<typeof CHART_DIRECTION>;
export type DeltaUnit = Values<typeof CHART_DELTA_UNIT>;
