'use client';

import React, { useState } from 'react';
import { ChartFrame, ChartTip, datumProps, type ChartTable, type LegendItem, type TipState } from './ChartFrame';
import { resolveFormats, textWidth } from './format';
import { defaultHeight, DESKTOP_MIN, useChartWidth } from './hooks';
import { areaPath, labelStride, linear, niceDomain, polyline, r1 } from './scale';
import { slotAt, slotColor, type ChartSlot } from './theme';
import { StatTile } from './StatTile';
import { summarize, type ChartCommonProps } from './types';

export interface LineSeries {
  label: string;
  values: number[];
  color?: ChartSlot;
}

export interface LineChartProps extends ChartCommonProps {
  categories: string[];
  /** One to three series. */
  series: LineSeries[];
  /** Label the last point with its short value. Default true. */
  markLast?: boolean;
  /** Fill under the line. `AreaChart` sets it; one series only. */
  area?: boolean;
}

/** Line stroke patterns by series position: the second and third differ without colour. */
export const LINE_DASH = [undefined, '6 4', '2 4'] as const;

export function LineChart({
  categories,
  series: allSeries,
  markLast = true,
  area = false,
  unit,
  valueFormat,
  axisFormat,
  summary,
  width: widthProp,
  height: heightProp,
  categoryLabel = 'Tanggal',
  state = 'ready',
  title,
  ...frame
}: LineChartProps): React.ReactElement {
  const fmt = resolveFormats(unit, valueFormat, axisFormat);
  const [ref, cw] = useChartWidth(widthProp);
  const [tip, setTip] = useState<TipState | null>(null);
  const series = (area ? allSeries.slice(0, 1) : allSeries.slice(0, 3)).map((s) => ({ ...s, values: categories.map((_, i) => s.values[i] ?? 0) }));
  const slots = series.map((s, i) => s.color ?? slotAt(i));

  const legend: LegendItem[] | undefined =
    series.length > 1 ? series.map((s, i) => ({ label: s.label, slot: slots[i], dash: LINE_DASH[i] ?? undefined })) : undefined;
  const table: ChartTable = {
    caption: title ?? 'Data tren',
    columns: [categoryLabel, ...series.map((s) => s.label)],
    rows: categories.map((c, i) => [c, ...series.map((s) => fmt.full(s.values[i]))]),
  };
  const first = series[0];
  const dirWord = first && first.values.length > 1 ? (first.values[first.values.length - 1] > first.values[0] ? 'naik' : first.values[first.values.length - 1] < first.values[0] ? 'turun' : 'tetap') : '';
  const summaryText =
    summary ??
    summarize(
      `${title ?? 'Grafik'}${dirWord ? `, ${dirWord}` : ''}`,
      categories.map((c, i) => [c, series.map((s) => (series.length > 1 ? `${s.label} ` : '') + fmt.full(s.values[i])).join(', ')]),
    );

  const frameState = state === 'ready' && (categories.length === 0 || series.length === 0) ? 'empty' : state;
  const base = { ...frame, title, state: frameState, legend, table } as const;
  if (frameState === 'ready' && categories.length === 1) {
    return (
      <ChartFrame {...base} table={undefined} legend={undefined}>
        <StatTile label={`${series[0].label}, ${categories[0]}`} value={fmt.full(series[0].values[0])} />
      </ChartFrame>
    );
  }

  const height = heightProp ?? defaultHeight(cw);
  const all = series.flatMap((s) => s.values);
  const dom = niceDomain(Math.min(...all, 0), Math.max(...all, 0), cw < DESKTOP_MIN ? 3 : 4);
  const axisW = Math.max(...dom.ticks.map((t) => textWidth(fmt.short(t))), 0) + 10;
  const padTop = 14;
  const padBottom = 22;
  const padRight = 12;
  const n = categories.length;
  const innerH = Math.max(40, height - padTop - padBottom);
  const sx = linear(0, Math.max(1, n - 1), axisW + 6, cw - padRight);
  const sy = linear(dom.min, dom.max, padTop + innerH, padTop);
  const stride = labelStride(Math.max(...categories.map((c) => textWidth(c, 11)), 0), (cw - axisW - padRight) / Math.max(1, n - 1));
  const lastIdx = n - 1;

  return (
    <ChartFrame {...base} height={heightProp ?? height}>
      <div ref={ref} className="ds-chart-plot" style={widthProp != null ? { width: widthProp } : undefined}>
        <div className="ds-chart-inner" style={{ width: cw }}>
          <svg width={cw} height={height} viewBox={`0 0 ${cw} ${height}`} role="group" aria-label={summaryText}>
            {dom.ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'ds-chart-zero' : 'ds-chart-grid'} x1={axisW} x2={cw - padRight / 2} y1={r1(sy(t))} y2={r1(sy(t))} />
                <text className="ds-chart-t" x={axisW - 8} y={r1(sy(t))} textAnchor="end" dominantBaseline="central">
                  {fmt.short(t)}
                </text>
              </g>
            ))}
            {series.map((s, si) => {
              const pts: Array<[number, number]> = s.values.map((v, i) => [sx(i), sy(v)]);
              return (
                <g key={si}>
                  {area && <path d={areaPath(pts, sy(0))} style={{ fill: slotColor(slots[si]), opacity: 0.14 }} />}
                  <polyline
                    points={polyline(pts)}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={LINE_DASH[si] ?? undefined}
                    style={{ stroke: slotColor(slots[si]) }}
                  />
                  {markLast && (
                    <>
                      <circle cx={r1(pts[lastIdx][0])} cy={r1(pts[lastIdx][1])} r={4} strokeWidth={2} style={{ fill: slotColor(slots[si]), stroke: 'rgb(var(--ds-chart-surface))' }} />
                      {si === 0 && (
                        <text
                          className="ds-chart-v"
                          x={r1(pts[lastIdx][0] - 6)}
                          y={r1(pts[lastIdx][1] - 10)}
                          textAnchor="end"
                        >
                          {fmt.short(s.values[lastIdx])}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}
            {categories.map((c, i) => {
              const step = (cw - padRight - axisW - 6) / Math.max(1, n - 1);
              const label = `${c}: ${series.map((s) => (series.length > 1 ? `${s.label} ` : '') + fmt.full(s.values[i])).join(', ')}`;
              const top = Math.min(...series.map((s) => sy(s.values[i])));
              return (
                <g
                  key={i}
                  {...datumProps(
                    () => setTip({ x: sx(i), y: top, title: c, lines: series.map((s, si) => ({ label: series.length > 1 ? s.label : undefined, value: fmt.full(s.values[i]), slot: slots[si] })) }),
                    () => setTip(null),
                    label,
                  )}
                >
                  <rect className="ds-chart-hit" x={r1(sx(i) - step / 2)} y={0} width={r1(Math.max(step, 24))} height={padTop + innerH} />
                  <circle className="ds-chart-ring" cx={r1(sx(i))} cy={r1(top)} r={7} />
                  {i % stride === 0 && (
                    <text className="ds-chart-t" x={r1(sx(i))} y={padTop + innerH + 16} textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'} style={{ fontSize: '0.6875rem' }}>
                      {c}
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

export type AreaChartProps = Omit<LineChartProps, 'area' | 'series'> & {
  /** A single series: an area chart says one thing. */
  series: LineSeries;
};

/** One series as a line with a soft fill down to zero. The last point is labelled. */
export function AreaChart({ series, ...rest }: AreaChartProps): React.ReactElement {
  return <LineChart {...rest} series={[series]} area />;
}
