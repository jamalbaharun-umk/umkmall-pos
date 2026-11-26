'use client';

import React, { useState } from 'react';
import { ChartFrame, ChartTip, datumProps, type ChartTable, type LegendItem, type TipState } from './ChartFrame';
import { formatPercent, resolveFormats } from './format';
import { useChartWidth } from './hooks';
import { layoutSegments, percents, r1, sequentialSteps } from './scale';
import { seqColor, slotAt, slotColor, type ChartSlot } from './theme';
import { summarize, type ChartCommonProps } from './types';
import type { SegmentPalette } from './vocab';

export interface SegmentPart {
  label: string;
  value: number;
  /** Fixed colour slot, `categorical` only. */
  color?: ChartSlot;
}

export interface SegmentedBarProps extends Omit<ChartCommonProps, 'height'> {
  parts: SegmentPart[];
  /**
   * `categorical`: the fixed order of a data kind (chart 1, 2, 3, ...). `sequential`: one
   * colour in steps, for ordered data such as an ageing (belum jatuh tempo ... lebih dari 30 hari).
   */
  palette?: SegmentPalette;
}

const BAR_H = 14;
const HIT_H = 28;

/** One bar cut into parts, with a legend that writes each value and its share. */
export function SegmentedBar({
  parts,
  palette = 'categorical',
  unit,
  valueFormat,
  axisFormat,
  summary,
  width: widthProp,
  categoryLabel = 'Bagian',
  state = 'ready',
  title,
  ...frame
}: SegmentedBarProps): React.ReactElement {
  const fmt = resolveFormats(unit, valueFormat, axisFormat);
  const [ref, cw] = useChartWidth(widthProp);
  const [tip, setTip] = useState<TipState | null>(null);
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const pct = percents(parts.map((p) => p.value));
  const steps = sequentialSteps(parts.length);
  const paint = (i: number): string => (palette === 'sequential' ? seqColor(steps[i]) : slotColor(parts[i].color ?? slotAt(i)));
  const legend: LegendItem[] = parts.map((p, i) => ({
    label: p.label,
    value: fmt.full(p.value),
    percent: formatPercent(pct[i]),
    ...(palette === 'sequential' ? { seq: steps[i] } : { slot: p.color ?? slotAt(i) }),
  }));
  const table: ChartTable = {
    caption: title ?? 'Data bagian',
    columns: [categoryLabel, 'Nilai', 'Bagian'],
    rows: parts.map((p, i) => [p.label, fmt.full(p.value), formatPercent(pct[i])]),
  };
  const summaryText = summary ?? summarize(title ?? 'Batang tersegmentasi', parts.map((p, i) => [p.label, `${fmt.full(p.value)} (${formatPercent(pct[i])})`]));
  const frameState = state === 'ready' && total <= 0 ? 'empty' : state;
  const segs = layoutSegments(parts.map((p) => p.value), cw);
  const top = (HIT_H - BAR_H) / 2;

  return (
    <ChartFrame {...frame} title={title} state={frameState} legend={legend} legendRows table={table} height={HIT_H}>
      <div ref={ref} className="ds-chart-plot" style={widthProp != null ? { width: widthProp } : undefined}>
        <div className="ds-chart-inner" style={{ width: cw }}>
          <svg width={cw} height={HIT_H} viewBox={`0 0 ${cw} ${HIT_H}`} role="group" aria-label={summaryText}>
            {parts.map((p, i) => {
              const s = segs[i];
              if (s.width <= 0) return null;
              const label = `${p.label}: ${fmt.full(p.value)}, ${formatPercent(pct[i])}`;
              return (
                <g key={`${p.label}-${i}`} {...datumProps(() => setTip({ x: s.x + s.width / 2, y: top, title: p.label, lines: [{ value: `${fmt.full(p.value)} (${formatPercent(pct[i])})` }] }), () => setTip(null), label)}>
                  <rect className="ds-chart-hit" x={r1(s.x)} y={0} width={r1(s.width)} height={HIT_H} />
                  <rect x={r1(s.x)} y={top} width={r1(s.width)} height={BAR_H} rx={4} style={{ fill: paint(i) }} />
                </g>
              );
            })}
          </svg>
          <ChartTip tip={tip} width={cw} />
        </div>
      </div>
    </ChartFrame>
  );
}
