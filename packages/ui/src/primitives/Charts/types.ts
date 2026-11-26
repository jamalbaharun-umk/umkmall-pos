import type { ChartFrameProps } from './ChartFrame';
import type { ChartUnit } from './format';

/** Props every chart takes: the frame's, the number format, and an explicit size. */
export interface ChartCommonProps
  extends Omit<ChartFrameProps, 'children' | 'legend' | 'legendRows' | 'footer' | 'table' | 'height'> {
  /** What the numbers are. Picks the full and the short format. Default `count`. */
  unit?: ChartUnit;
  /** Full value (tooltip, legend, table). Overrides `unit`. */
  valueFormat?: (n: number) => string;
  /** Short value (axis). Overrides `unit`; defaults to `valueFormat` when that is given. */
  axisFormat?: (n: number) => string;
  /** One sentence for screen readers; written from the data when omitted. */
  summary?: string;
  /** Draw at this width in px (a PDF does). Omitted: follow the container. */
  width?: number;
  /** Draw at this height in px. Omitted: 140 on a phone, 220 on desktop. */
  height?: number;
  /** Table heading for the first column. */
  categoryLabel?: string;
}

export function summarize(prefix: string, pairs: Array<[string, string]>, max = 8): string {
  const head = pairs.slice(0, max).map(([k, v]) => `${k} ${v}`);
  const more = pairs.length > max ? `, dan ${pairs.length - max} lainnya` : '';
  return `${prefix}: ${head.join(', ')}${more}.`;
}
