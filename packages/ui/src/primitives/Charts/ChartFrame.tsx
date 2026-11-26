'use client';

import React, { useState } from 'react';
import { ChartStyles, slotColor, seqColor, type ChartSlot } from './theme';
import type { ChartHeading, ChartState } from './vocab';

export type { ChartState } from './vocab';

/** The table that says the same as the picture. First column is the row label. */
export interface ChartTable {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface LegendItem {
  label: string;
  /** Written value, shown beside the label. */
  value?: string;
  /** Written share, shown at the right edge. */
  percent?: string;
  /** Categorical slot, or a step 1-5 of the single-colour ramp. */
  slot?: ChartSlot;
  seq?: number;
  /** A dashed line swatch (a second or third line series), so lines differ without colour. */
  dash?: string;
}

export interface ChartFrameProps {
  title?: string;
  description?: string;
  titleAs?: ChartHeading;
  /** `ready` draws the chart. The default. */
  state?: ChartState;
  onRetry?: () => void;
  loadingText?: string;
  emptyText?: string;
  emptyHint?: string;
  errorText?: string;
  /** Height of the skeleton and the empty box. */
  height?: number;
  legend?: LegendItem[];
  /** A legend that lists a value for each part, as rows. */
  legendRows?: boolean;
  footer?: React.ReactNode;
  table?: ChartTable;
  /** Start with the table open (the PDF does). */
  showTable?: boolean;
  /** Hide the "Lihat tabel" button. The table is then never shown. */
  hideTableToggle?: boolean;
  /** A card around the chart: border, surface, padding. */
  boxed?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function LegendSwatch({ item }: { item: LegendItem }): React.ReactElement {
  const color = item.seq != null ? seqColor(item.seq) : slotColor(item.slot ?? 1);
  if (item.dash) {
    return (
      <svg className="ds-chart-sw" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ overflow: 'visible' }}>
        <line x1="0" x2="12" y1="6" y2="6" strokeWidth="2.5" strokeDasharray={item.dash} style={{ stroke: color }} />
      </svg>
    );
  }
  return <span className="ds-chart-sw" aria-hidden="true" style={{ background: color }} />;
}

export function ChartLegend({ items, rows }: { items: LegendItem[]; rows?: boolean }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <ul className={rows ? 'ds-chart-legend ds-chart-legend-rows' : 'ds-chart-legend'}>
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`}>
          <LegendSwatch item={item} />
          <span className="ds-chart-legend-label" title={item.label}>
            {item.label}
          </span>
          {item.value != null && <span className="ds-chart-legend-value">{item.value}</span>}
          {item.percent != null && <span className="ds-chart-legend-pct">{item.percent}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ChartTableView({ table }: { table: ChartTable }): React.ReactElement {
  return (
    <div className="ds-chart-tablewrap">
      <table className="ds-chart-table">
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={`${c}-${i}`} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={c}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The one wrapper every chart sits in, so loading, empty and error look the same everywhere:
 * title, optional legend with written values, the chart, a table that says the same, and a
 * "Lihat tabel" button. Not the nav shell's business: it carries no page layout.
 *
 * - `loading`: a skeleton as large as the chart, announced politely.
 * - `empty`: a dashed box with one sentence of advice.
 * - `error`: a clear message and "Muat ulang" (when `onRetry` is given); no old chart.
 */
export function ChartFrame({
  title,
  description,
  titleAs: Title = 'h3',
  state = 'ready',
  onRetry,
  loadingText,
  emptyText = 'Grafik muncul setelah ada data.',
  emptyHint,
  errorText = 'Grafik tidak bisa dimuat.',
  height = 140,
  legend,
  legendRows,
  footer,
  table,
  showTable = false,
  hideTableToggle,
  boxed,
  className,
  children,
}: ChartFrameProps): React.ReactElement {
  const [open, setOpen] = useState(showTable);
  const ready = state === 'ready';
  const canToggle = ready && !!table && !hideTableToggle;
  const label = title ?? 'grafik';
  return (
    <section
      className={['ds-chart', boxed ? 'ds-chart-boxed' : '', className ?? ''].filter(Boolean).join(' ')}
      aria-busy={state === 'loading' || undefined}
    >
      <ChartStyles />
      {(title || description || canToggle) && (
        <div className="ds-chart-head">
          <div style={{ minWidth: 0 }}>
            {title && <Title className="ds-chart-title">{title}</Title>}
            {description && <p className="ds-chart-desc">{description}</p>}
          </div>
          {canToggle && (
            <button type="button" className="ds-chart-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? 'Sembunyikan tabel' : 'Lihat tabel'}
            </button>
          )}
        </div>
      )}
      {state === 'loading' && (
        <div role="status">
          <div className="ds-chart-skel" style={{ height }} aria-hidden="true" />
          <span className="ds-chart-hint">{loadingText ?? `Memuat ${label}…`}</span>
        </div>
      )}
      {state === 'empty' && (
        <div className="ds-chart-state ds-chart-empty" style={{ minHeight: height }}>
          <span>{emptyText}</span>
          {emptyHint && <span className="ds-chart-hint">{emptyHint}</span>}
        </div>
      )}
      {state === 'error' && (
        <div className="ds-chart-state ds-chart-empty" role="alert" style={{ minHeight: height }}>
          <span>{errorText}</span>
          {onRetry && (
            <button type="button" className="ds-chart-btn" onClick={onRetry}>
              Muat ulang
            </button>
          )}
        </div>
      )}
      {ready && children}
      {ready && legend && <ChartLegend items={legend} rows={legendRows} />}
      {ready && footer}
      {canToggle && open && table && <ChartTableView table={table} />}
    </section>
  );
}

export interface TipLine {
  label?: string;
  value: string;
  slot?: ChartSlot;
}

export interface TipState {
  x: number;
  y: number;
  title: string;
  lines: TipLine[];
}

/** The value readout shown on hover, focus or tap. Positioned in px inside `.ds-chart-inner`. */
export function ChartTip({ tip, width }: { tip: TipState | null; width: number }): React.ReactElement | null {
  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 72), Math.max(72, width - 72));
  return (
    <div className="ds-chart-tip" role="status" style={{ left: x, top: Math.max(tip.y, 0) }}>
      <b>{tip.title}</b>
      {tip.lines.map((l, i) => (
        <div key={i}>
          <span>{l.label ?? ''}</span>
          <span>{l.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Pointer, touch and keyboard wiring for one datum. */
export function datumProps(
  show: () => void,
  hide: () => void,
  label: string,
  onSelect?: () => void,
): React.SVGProps<SVGGElement> {
  return {
    tabIndex: 0,
    role: onSelect ? 'button' : 'img',
    'aria-label': label,
    onPointerEnter: show,
    onPointerDown: show,
    onPointerLeave: hide,
    onFocus: show,
    onBlur: hide,
    onClick: onSelect,
    onKeyDown: onSelect
      ? (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }
      : undefined,
    'data-datum': '',
  } as React.SVGProps<SVGGElement>;
}
