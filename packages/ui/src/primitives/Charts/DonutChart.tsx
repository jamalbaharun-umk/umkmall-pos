'use client';

import React, { useState } from 'react';
import { ChartFrame, ChartTip, datumProps, type ChartTable, type LegendItem, type TipState } from './ChartFrame';
import { formatPercent, resolveFormats } from './format';
import { useChartWidth } from './hooks';
import { r3, toSlices } from './scale';
import { slotAt, slotColor, type ChartSlot } from './theme';
import { summarize, type ChartCommonProps } from './types';

export interface DonutPart {
  label: string;
  value: number;
  /** Fixed colour slot (the colour follows the thing, not its rank). Default: by rank. */
  color?: ChartSlot;
}

export interface DonutChartProps extends Omit<ChartCommonProps, 'height'> {
  parts: DonutPart[];
  /** Total written in the middle. Default: the sum of the parts, short format. */
  total?: number;
  /** Small text under the total. Default `Total`. */
  centerLabel?: string;
  /** Diameter in px. Default 160 on a phone, 200 when the container is wide. */
  size?: number;
  /** At most 5 parts show; the rest fold into "Lainnya". */
  maxParts?: number;
}

const THICKNESS = 0.2;
const GAP_PX = 2;

export function DonutChart({
  parts,
  total: totalProp,
  centerLabel = 'Total',
  size: sizeProp,
  maxParts = 5,
  unit,
  valueFormat,
  axisFormat,
  summary,
  width: widthProp,
  categoryLabel = 'Bagian',
  state = 'ready',
  title,
  ...frame
}: DonutChartProps): React.ReactElement {
  const fmt = resolveFormats(unit, valueFormat, axisFormat);
  const [ref, cw] = useChartWidth(widthProp);
  const [tip, setTip] = useState<TipState | null>(null);

  const slices = toSlices(parts, Math.min(5, maxParts));
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const total = totalProp ?? sum;
  const colorOf = (i: number): ChartSlot => {
    const s = slices[i];
    if (s.merged) return 'other';
    return parts[s.index]?.color ?? slotAt(i);
  };
  const legend: LegendItem[] = slices.map((s, i) => ({ label: s.label, value: fmt.full(s.value), percent: formatPercent(s.percent), slot: colorOf(i) }));
  const table: ChartTable = {
    caption: title ?? 'Data komposisi',
    columns: [categoryLabel, 'Nilai', 'Bagian'],
    rows: slices.map((s) => [s.label, fmt.full(s.value), formatPercent(s.percent)]),
  };
  const summaryText = summary ?? summarize(title ?? 'Diagram lingkaran', slices.map((s) => [s.label, `${fmt.full(s.value)} (${formatPercent(s.percent)})`]));
  const frameState = state === 'ready' && sum <= 0 ? 'empty' : state;

  const size = sizeProp ?? (cw >= 480 ? 200 : 160);
  const r = (size * (1 - THICKNESS)) / 2;
  const stroke = size * THICKNESS;
  const circ = 2 * Math.PI * r;
  const gapLen = slices.length > 1 ? (GAP_PX / circ) * 100 : 0;

  return (
    <ChartFrame {...frame} title={title} state={frameState} legend={legend} legendRows table={table} height={size}>
      <div ref={ref} className="ds-chart-plot" style={{ width: widthProp ?? undefined }}>
        <div className="ds-chart-inner" style={{ width: size, margin: '0 auto' }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label={summaryText}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'rgb(var(--ds-chart-track))' }} />
            <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              {slices.map((s, i) => {
                const len = Math.max(0.4, s.length - gapLen);
                const label = `${s.label}: ${fmt.full(s.value)}, ${formatPercent(s.percent)}`;
                const mid = s.start + s.length / 2;
                const ang = (mid / 100) * 2 * Math.PI - Math.PI / 2;
                const tx = size / 2 + Math.cos(ang) * r;
                const ty = size / 2 + Math.sin(ang) * r;
                return (
                  <g key={`${s.label}-${i}`} {...datumProps(() => setTip({ x: tx, y: ty - stroke / 2, title: s.label, lines: [{ value: `${fmt.full(s.value)} (${formatPercent(s.percent)})`, slot: colorOf(i) }] }), () => setTip(null), label)}>
                    <circle
                      cx={size / 2}
                      cy={size / 2}
                      r={r}
                      fill="none"
                      strokeWidth={stroke}
                      pathLength={100}
                      strokeDasharray={`${r3(len)} ${r3(100 - len)}`}
                      strokeDashoffset={r3(-(s.start + (s.length - len) / 2))}
                      style={{ stroke: slotColor(colorOf(i)) }}
                    />
                  </g>
                );
              })}
            </g>
            <text className="ds-chart-c" x={size / 2} y={size / 2 - 2} textAnchor="middle" dominantBaseline="central">
              {fmt.short(total)}
            </text>
            <text className="ds-chart-t" x={size / 2} y={size / 2 + 16} textAnchor="middle" dominantBaseline="central">
              {centerLabel}
            </text>
          </svg>
          <ChartTip tip={tip} width={size} />
        </div>
      </div>
    </ChartFrame>
  );
}

