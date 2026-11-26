'use client';

import React, { useState } from 'react';
import { ChartFrame, ChartTip, datumProps, type ChartTable, type TipState } from './ChartFrame';
import { resolveFormats } from './format';
import { useChartWidth } from './hooks';
import { heatLevel, labelStride, r1 } from './scale';
import { seqColor } from './theme';
import { summarize, type ChartCommonProps } from './types';

export interface HeatStripProps extends Omit<ChartCommonProps, 'height'> {
  /** One value per cell (per hour or per day). */
  values: number[];
  /** One label per cell. */
  labels: string[];
  /** Name of what is counted, written in the tooltip and the table: `Penjualan`. */
  valueLabel?: string;
}

const CELL_H = 32;
const GAP = 2;

/** One colour in five steps, darker for busier. Zero is the empty track. Values are written in the tooltip and the table. */
export function HeatStrip({
  values,
  labels,
  valueLabel = 'Jumlah',
  unit,
  valueFormat,
  axisFormat,
  summary,
  width: widthProp,
  categoryLabel = 'Waktu',
  state = 'ready',
  title,
  ...frame
}: HeatStripProps): React.ReactElement {
  const fmt = resolveFormats(unit, valueFormat, axisFormat);
  const [ref, cw] = useChartWidth(widthProp);
  const [tip, setTip] = useState<TipState | null>(null);
  const n = labels.length;
  const max = Math.max(...values, 0);
  const peak = values.indexOf(max);
  const table: ChartTable = { caption: title ?? 'Data per waktu', columns: [categoryLabel, valueLabel], rows: labels.map((l, i) => [l, fmt.full(values[i] ?? 0)]) };
  const summaryText =
    summary ?? (max > 0 ? `${title ?? 'Strip panas'}: paling ramai ${labels[peak]} (${fmt.full(max)}). ${summarize('Semua', labels.map((l, i) => [l, fmt.full(values[i] ?? 0)]), 24)}` : `${title ?? 'Strip panas'}: belum ada data.`);
  const frameState = state === 'ready' && (n === 0 || max <= 0) ? 'empty' : state;
  const cell = (cw - GAP * (n - 1)) / Math.max(1, n);
  const stride = labelStride(Math.max(...labels.map((l) => l.length * 6.6), 0), cell + GAP);
  const H = CELL_H + 18;
  const legendSteps = [0, 1, 2, 3, 4, 5];

  return (
    <ChartFrame
      {...frame}
      title={title}
      state={frameState}
      table={table}
      height={H}
      footer={
        <div className="ds-chart-legend" aria-hidden="true" style={{ alignItems: 'center' }}>
          <span>Sepi</span>
          <span style={{ display: 'inline-flex', gap: 2 }}>
            {legendSteps.map((s) => (
              <span key={s} className="ds-chart-sw" style={{ background: s === 0 ? 'rgb(var(--ds-chart-track))' : seqColor(s) }} />
            ))}
          </span>
          <span>Ramai ({fmt.full(max)})</span>
        </div>
      }
    >
      <div ref={ref} className="ds-chart-plot" style={widthProp != null ? { width: widthProp } : undefined}>
        <div className="ds-chart-inner" style={{ width: cw }}>
          <svg width={cw} height={H} viewBox={`0 0 ${cw} ${H}`} role="group" aria-label={summaryText}>
            {labels.map((l, i) => {
              const v = values[i] ?? 0;
              const lv = heatLevel(v, max);
              const x = i * (cell + GAP);
              return (
                <g key={`${l}-${i}`} {...datumProps(() => setTip({ x: x + cell / 2, y: 0, title: l, lines: [{ label: valueLabel, value: fmt.full(v) }] }), () => setTip(null), `${l}: ${fmt.full(v)}`)}>
                  <rect className="ds-chart-hit" x={r1(x)} y={0} width={r1(cell + GAP)} height={H} />
                  <rect x={r1(x)} y={0} width={r1(cell)} height={CELL_H} rx={4} style={{ fill: lv === 0 ? 'rgb(var(--ds-chart-track))' : seqColor(lv) }} />
                  {i % stride === 0 && (
                    <text className="ds-chart-t" x={r1(x + cell / 2)} y={CELL_H + 13} textAnchor="middle" style={{ fontSize: '0.6875rem' }}>
                      {l}
                    </text>
                  )}
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
