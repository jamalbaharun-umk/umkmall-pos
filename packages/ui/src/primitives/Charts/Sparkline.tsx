import React from 'react';
import { ChartStyles } from './theme';
import { formatInt } from './format';
import { linear, polyline, r1 } from './scale';
import { slotColor } from './theme';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Read by screen readers; written from the first and last value when omitted. */
  label?: string;
  className?: string;
}

/** A small trend line for a tile or a row. Two values at least; fewer draws nothing. */
export function Sparkline({ values, width = 96, height = 28, label, className }: SparklineProps): React.ReactElement | null {
  if (values.length < 2) return null;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = linear(0, values.length - 1, pad, width - pad);
  const y = linear(min, max === min ? min + 1 : max, height - pad, pad);
  const pts: Array<[number, number]> = values.map((v, i) => [x(i), max === min ? height / 2 : y(v)]);
  const last = pts[pts.length - 1];
  const first = values[0];
  const end = values[values.length - 1];
  const trend = end > first ? 'naik' : end < first ? 'turun' : 'tetap';
  const text = label ?? `Tren ${trend}, dari ${formatInt(first)} ke ${formatInt(end)}`;
  return (
    <span className={['ds-chart', className ?? ''].filter(Boolean).join(' ')} style={{ display: 'inline-block', lineHeight: 0 }}>
      <ChartStyles />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={text}>
        <polyline
          points={polyline(pts)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ stroke: slotColor(1) }}
        />
        <circle cx={r1(last[0])} cy={r1(last[1])} r={3} strokeWidth={1.5} style={{ fill: slotColor(1), stroke: 'rgb(var(--ds-chart-surface))' }} />
      </svg>
    </span>
  );
}
