'use client';

import React, { useState } from 'react';
import {
  ChartFrame,
  ChartTip,
  datumProps,
  type ChartTable,
  type LegendItem,
  type TipState,
} from './ChartFrame';
import { resolveFormats, textWidth, truncate } from './format';
import { defaultHeight, DESKTOP_MIN, useChartWidth } from './hooks';
import { bands, labelStride, linear, niceDomain, r1 } from './scale';
import { slotAt, slotColor, type ChartSlot } from './theme';
import { StatTile } from './StatTile';
import { summarize, type ChartCommonProps } from './types';
import type { BarOrientation, BarSort } from './vocab';

export interface BarSeries {
  label: string;
  /** One value per category, integer. */
  values: number[];
  /** Fixed colour slot. Default: by position (1, 2, 3). */
  color?: ChartSlot;
}

export interface BarChartProps extends ChartCommonProps {
  categories: string[];
  /** One series, two grouped side by side, or any number stacked. */
  series: BarSeries[];
  /** `vertical` columns (default) or `horizontal` bars, which also draw a bridge from zero. */
  orientation?: BarOrientation;
  /** Stack the series in one bar (non-negative values). */
  stacked?: boolean;
  /** `desc` orders categories from the largest of the first series. Default keeps your order. */
  sort?: BarSort;
  /** Makes each bar a button; called with the category and series index. */
  onSelect?: (pick: { category: number; series: number }) => void;
}

interface Row {
  category: string;
  index: number;
  values: number[];
}

const AXIS_PAD = 10;

export function BarChart(props: BarChartProps): React.ReactElement {
  const {
    categories,
    series,
    orientation = 'vertical',
    stacked = false,
    sort = 'none',
    onSelect,
    unit,
    valueFormat,
    axisFormat,
    summary,
    width: widthProp,
    height: heightProp,
    categoryLabel = 'Kategori',
    state = 'ready',
    title,
    ...frame
  } = props;
  const fmt = resolveFormats(unit, valueFormat, axisFormat);
  const [ref, cw] = useChartWidth(widthProp);
  const [tip, setTip] = useState<TipState | null>(null);

  let rows: Row[] = categories.map((category, index) => ({
    category,
    index,
    values: series.map((s) => s.values[index] ?? 0),
  }));
  if (sort === 'desc') rows = [...rows].sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0) || a.index - b.index);

  const slots = series.map((s, i) => s.color ?? slotAt(i));
  const legend: LegendItem[] | undefined =
    series.length > 1 ? series.map((s, i) => ({ label: s.label, slot: slots[i] })) : undefined;
  const table: ChartTable = {
    caption: title ?? 'Data diagram',
    columns: [categoryLabel, ...series.map((s) => s.label)],
    rows: rows.map((r) => [r.category, ...r.values.map(fmt.full)]),
  };
  const summaryText =
    summary ??
    summarize(
      title ?? 'Diagram batang',
      rows.map((r) => [r.category, series.length === 1 ? fmt.full(r.values[0]) : r.values.map((v, i) => `${series[i].label} ${fmt.full(v)}`).join(' dan ')]),
    );

  const frameState = state === 'ready' && rows.length === 0 ? 'empty' : state;
  const base = { ...frame, title, state: frameState, legend, table, legendRows: false } as const;

  if (frameState === 'ready' && rows.length === 1 && series.length === 1) {
    return (
      <ChartFrame {...base} table={undefined}>
        <StatTile label={rows[0].category} value={fmt.full(rows[0].values[0])} />
      </ChartFrame>
    );
  }
  const height = heightProp ?? defaultHeight(cw);
  const show = (t: TipState) => () => setTip(t);
  const hide = () => setTip(null);
  const pick = (category: number, s: number) => (onSelect ? () => onSelect({ category, series: s }) : undefined);

  const lineFor = (r: Row, onlyIndex?: number): TipState['lines'] =>
    r.values
      .map((v, i) => ({ label: series.length > 1 ? series[i].label : undefined, value: fmt.full(v), slot: slots[i] }))
      .filter((_, i) => onlyIndex == null || i === onlyIndex);
  const colorFor = (v: number, s: number) => (series.length === 1 && v < 0 ? slotColor('neg') : slotColor(slots[s]));

  let body: React.ReactElement;
  let plotWidth = cw;
  let scroll = false;

  if (orientation === 'horizontal') {
    const k = stacked ? 1 : Math.max(1, series.length);
    const sub = k > 1 ? 16 : 12;
    const gap = k > 1 ? 2 : 0;
    const pitch = Math.max(onSelect ? 44 : 32, k * (sub + gap) + 14);
    const labelW = Math.min(Math.max(...rows.map((r) => textWidth(r.category)), 40), Math.floor(cw * 0.34), 140) + 8;
    const all = rows.flatMap((r) => r.values);
    const stackTotals = rows.map((r) => r.values.reduce((a, v) => a + Math.max(0, v), 0));
    const maxV = stacked ? Math.max(...stackTotals, 0) : Math.max(...all, 0);
    const minV = stacked ? 0 : Math.min(...all, 0);
    const valueW = Math.max(...all.map((v) => textWidth(fmt.full(v))), 0) + 8;
    const x0 = labelW;
    const x1 = Math.max(x0 + 24, cw - valueW);
    const dom = { min: minV, max: maxV === minV ? minV + 1 : maxV };
    const sx = linear(dom.min, dom.max, x0, x1);
    const zero = sx(0);
    const h = rows.length * pitch;
    body = (
      <svg width={cw} height={h} viewBox={`0 0 ${cw} ${h}`} role="group" aria-label={summaryText}>
        {minV < 0 && <line className="ds-chart-zero" x1={r1(zero)} x2={r1(zero)} y1={0} y2={h} />}
        {rows.map((r, ri) => {
          const top = ri * pitch;
          const cy = top + pitch / 2;
          const label = `${r.category}: ${r.values.map((v, i) => (series.length > 1 ? `${series[i].label} ` : '') + fmt.full(v)).join(', ')}`;
          let acc = 0;
          const maxEnd = Math.max(...r.values.map((v) => sx(v)), zero);
          return (
            <g
              key={r.index}
              {...datumProps(show({ x: Math.min(maxEnd, cw - 20), y: top + 4, title: r.category, lines: lineFor(r) }), hide, label, pick(r.index, 0))}
              style={onSelect ? { cursor: 'pointer' } : undefined}
            >
              <rect className="ds-chart-hit" x={0} y={top} width={cw} height={pitch} />
              <rect className="ds-chart-ring" x={1} y={top + 1} width={cw - 2} height={pitch - 2} rx={6} />
              <text className="ds-chart-t" x={0} y={cy} dominantBaseline="central">
                {truncate(r.category, labelW - 8)}
                <title>{r.category}</title>
              </text>
              {r.values.map((v, i) => {
                const yy = stacked ? cy - sub / 2 : cy - (k * (sub + gap) - gap) / 2 + i * (sub + gap);
                let xa: number;
                let wd: number;
                if (stacked) {
                  const a = sx(acc);
                  acc += Math.max(0, v);
                  xa = a;
                  wd = Math.max(0, sx(acc) - a - (v > 0 ? 1 : 0));
                } else {
                  const e = sx(v);
                  xa = Math.min(zero, e);
                  wd = Math.abs(e - zero);
                }
                return (
                  <g key={i}>
                    {(wd > 0 || v === 0) && (
                      <rect x={r1(xa)} y={r1(yy)} width={r1(Math.max(wd, v === 0 ? 0 : 2))} height={sub} rx={Math.min(4, sub / 2)} style={{ fill: colorFor(v, i) }} />
                    )}
                    {!stacked && (
                      <text className="ds-chart-v" x={cw} y={yy + sub / 2} textAnchor="end" dominantBaseline="central">
                        {fmt.full(v)}
                      </text>
                    )}
                  </g>
                );
              })}
              {stacked && (
                <text className="ds-chart-v" x={cw} y={cy} textAnchor="end" dominantBaseline="central">
                  {fmt.full(stackTotals[ri])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  } else {
    const all = rows.flatMap((r) => r.values);
    const stackTop = rows.map((r) => r.values.reduce((a, v) => a + Math.max(0, v), 0));
    const maxV = stacked ? Math.max(...stackTop, 0) : Math.max(...all, 0);
    const minV = stacked ? 0 : Math.min(...all, 0);
    const dom = niceDomain(minV, maxV, cw < DESKTOP_MIN ? 3 : 4);
    const axisW = Math.max(...dom.ticks.map((t) => textWidth(fmt.short(t))), 0) + AXIS_PAD;
    const padTop = 8;
    const padBottom = 22;
    const innerH = Math.max(40, height - padTop - padBottom);
    const n = rows.length;
    /* On a phone at most 7 categories are in view, the rest scroll. */
    const minBand = cw < DESKTOP_MIN ? Math.floor((cw - axisW) / 7) : 24;
    const bandPx = Math.max((cw - axisW) / n, minBand);
    plotWidth = Math.ceil(axisW + bandPx * n);
    scroll = plotWidth > cw;
    const bd = bands(n, bandPx * n, 0.3);
    const sy = linear(dom.min, dom.max, padTop + innerH, padTop);
    const zeroY = sy(0);
    const k = stacked ? 1 : Math.max(1, series.length);
    const barW = Math.max(3, Math.min(28, (bd.bandwidth - 2 * (k - 1)) / k));
    const groupW = barW * k + 2 * (k - 1);
    const stride = labelStride(Math.max(...rows.map((r) => textWidth(r.category, 11))), bandPx);
    body = (
      <svg width={plotWidth} height={height} viewBox={`0 0 ${plotWidth} ${height}`} role="group" aria-label={summaryText}>
        {dom.ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'ds-chart-zero' : 'ds-chart-grid'} x1={axisW} x2={plotWidth} y1={r1(sy(t))} y2={r1(sy(t))} />
            <text className="ds-chart-t" x={axisW - AXIS_PAD + 2} y={r1(sy(t))} textAnchor="end" dominantBaseline="central">
              {fmt.short(t)}
            </text>
          </g>
        ))}
        {rows.map((r, ri) => {
          const cx = axisW + bd.start(ri) + bd.bandwidth / 2;
          const gx = cx - groupW / 2;
          let acc = 0;
          const label = `${r.category}: ${r.values.map((v, i) => (series.length > 1 ? `${series[i].label} ` : '') + fmt.full(v)).join(', ')}`;
          const topY = Math.min(...r.values.map((v) => sy(stacked ? stackTop[ri] : v)), zeroY);
          return (
            <g
              key={r.index}
              {...datumProps(show({ x: cx, y: topY, title: r.category, lines: lineFor(r) }), hide, label, pick(r.index, 0))}
              style={onSelect ? { cursor: 'pointer' } : undefined}
            >
              <rect className="ds-chart-hit" x={axisW + ri * bandPx} y={0} width={bandPx} height={padTop + innerH} />
              <rect className="ds-chart-ring" x={axisW + ri * bandPx + 1} y={1} width={bandPx - 2} height={padTop + innerH - 2} rx={6} />
              {r.values.map((v, i) => {
                let y0: number;
                let y1: number;
                if (stacked) {
                  y1 = sy(acc);
                  acc += Math.max(0, v);
                  y0 = sy(acc);
                } else {
                  y0 = Math.min(sy(v), zeroY);
                  y1 = Math.max(sy(v), zeroY);
                }
                const hgt = Math.max(v === 0 ? 0 : 2, y1 - y0 - (stacked && v > 0 ? 1 : 0));
                return hgt > 0 ? (
                  <rect
                    key={i}
                    x={r1(stacked ? cx - barW / 2 : gx + i * (barW + 2))}
                    y={r1(y0)}
                    width={barW}
                    height={r1(hgt)}
                    rx={Math.min(4, barW / 2)}
                    style={{ fill: colorFor(v, i) }}
                  />
                ) : null;
              })}
              {ri % stride === 0 && (
                <text className="ds-chart-t" x={r1(cx)} y={padTop + innerH + 16} textAnchor="middle" style={{ fontSize: '0.6875rem' }}>
                  {truncate(r.category, Math.max(bandPx * stride - 4, 24), 11)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <ChartFrame {...base} height={heightProp ?? height}>
      <div ref={ref} className="ds-chart-plot" style={widthProp != null ? { width: widthProp } : undefined}>
        <div className={scroll ? 'ds-chart-scroll' : undefined}>
          <div className="ds-chart-inner" style={{ width: plotWidth }}>
            {body}
            <ChartTip tip={tip} width={plotWidth} />
          </div>
        </div>
      </div>
    </ChartFrame>
  );
}
