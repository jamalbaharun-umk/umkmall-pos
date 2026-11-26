import React from 'react';
import { ChartFrame, type ChartFrameProps, type ChartTable } from './ChartFrame';
import { formatInt } from './format';
import { clamp } from './scale';
import { ChartStyles, slotColor } from './theme';
import type { MeterStatus } from './vocab';

export type { MeterStatus } from './vocab';

export interface MeterProps {
  label: string;
  value: number;
  /** The full level the bar is measured against ("dari 20"). */
  max: number;
  /** Minimum level: drawn as a tick, and `low` at or under it. */
  limit?: number;
  /** After the numbers: `pcs`. */
  unit?: string;
  /** Overrides the status worked out from `value` and `limit`. */
  status?: MeterStatus;
  className?: string;
}

export function meterStatus(value: number, limit?: number): MeterStatus {
  if (value <= 0) return 'empty';
  if (limit != null && value <= limit) return 'low';
  return 'ok';
}

const STATUS_TEXT: Record<MeterStatus, string> = { ok: '', low: 'Menipis', empty: 'Habis' };

function statusColor(status: MeterStatus): string {
  return status === 'empty' ? 'rgb(var(--ds-chart-status-bad))' : status === 'low' ? 'rgb(var(--ds-chart-status-warn))' : slotColor(1);
}

/**
 * A level against a full amount, with a tick at the minimum. The one chart that uses status
 * colours, because the thing it shows is a status; the status is also written ("Habis",
 * "Menipis"), so it does not depend on colour.
 */
export function Meter({ label, value, max, limit, unit, status, className }: MeterProps): React.ReactElement {
  const st = status ?? meterStatus(value, limit);
  const span = Math.max(1, max);
  const fill = clamp((Math.max(0, value) / span) * 100, 0, 100);
  const tick = limit != null ? clamp((limit / span) * 100, 0, 100) : null;
  const text = `${formatInt(value)} dari ${formatInt(max)}${unit ? ` ${unit}` : ''}`;
  return (
    <div className={['ds-chart', 'ds-chart-meter', className ?? ''].filter(Boolean).join(' ')}>
      <ChartStyles />
      <div className="ds-chart-meter-head">
        <span className="ds-chart-meter-name" title={label}>{label}</span>
        {STATUS_TEXT[st] && (
          <span className="ds-chart-badge" style={{ color: statusColor(st) }}>
            {STATUS_TEXT[st]}
          </span>
        )}
        <span className="ds-chart-meter-val">{text}</span>
      </div>
      <svg width="100%" height="10" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={clamp(value, 0, max)} aria-valuetext={`${text}${STATUS_TEXT[st] ? `, ${STATUS_TEXT[st].toLowerCase()}` : ''}`}>
        <rect x="0" y="1" width="100%" height="8" rx="4" style={{ fill: 'rgb(var(--ds-chart-track))' }} />
        {fill > 0 && <rect x="0" y="1" width={`${fill}%`} height="8" rx="4" style={{ fill: statusColor(st) }} />}
        {tick != null && <rect x={`${tick}%`} y="0" width="2" height="10" style={{ fill: 'rgb(var(--ds-chart-text))' }} />}
      </svg>
    </div>
  );
}

export interface MeterListProps extends Omit<ChartFrameProps, 'children' | 'table' | 'legend'> {
  items: MeterProps[];
  unit?: string;
}

/** Several meters in a frame, with the table of the same numbers. */
export function MeterList({ items, unit, state = 'ready', ...frame }: MeterListProps): React.ReactElement {
  const table: ChartTable = {
    caption: frame.title ?? 'Data stok',
    columns: ['Nama', 'Jumlah', 'Penuh', 'Batas minimal', 'Status'],
    rows: items.map((m) => [m.label, formatInt(m.value), formatInt(m.max), m.limit != null ? formatInt(m.limit) : '-', STATUS_TEXT[m.status ?? meterStatus(m.value, m.limit)] || 'Cukup']),
  };
  const frameState = state === 'ready' && items.length === 0 ? 'empty' : state;
  return (
    <ChartFrame {...frame} state={frameState} table={table} height={Math.max(60, items.length * 40)}>
      <ul className="ds-chart-meters">
        {items.map((m, i) => (
          <li key={`${m.label}-${i}`}>
            <Meter {...{ unit, ...m }} />
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
