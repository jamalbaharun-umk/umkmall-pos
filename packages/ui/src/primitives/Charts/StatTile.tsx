import React from 'react';
import { ChartStyles } from './theme';
import { formatInt, formatPercent } from './format';
import { Sparkline } from './Sparkline';
import { clamp } from './scale';
import { slotColor } from './theme';
import type { DeltaUnit, Direction } from './vocab';

export interface StatDelta {
  /** Change, integer. The sign picks naik / turun / tetap. */
  value: number;
  /** `percent` (default) writes 8%, `count` writes 8. */
  unit?: DeltaUnit;
  /** After the change: "dari minggu lalu". */
  label?: string;
}

export interface StatTileProps {
  label: string;
  /** Already formatted: `Rp10.180.000`. */
  value: string;
  delta?: StatDelta;
  /** Points of the small line. */
  values?: number[];
  hint?: string;
  className?: string;
}

function Arrow({ dir }: { dir: Direction }): React.ReactElement {
  const d = dir === 'naik' ? 'M2 8 L6 3 L10 8 Z' : dir === 'turun' ? 'M2 4 L6 9 L10 4 Z' : 'M2 6 H10';
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={d} strokeWidth={dir === 'tetap' ? 2 : 0} style={{ fill: dir === 'tetap' ? 'none' : slotColor(1), stroke: slotColor(1) }} />
    </svg>
  );
}

function deltaText(d: StatDelta): { dir: Direction; text: string } {
  const dir = d.value > 0 ? 'naik' : d.value < 0 ? 'turun' : 'tetap';
  const abs = Math.abs(d.value);
  const amount = (d.unit ?? 'percent') === 'percent' ? formatPercent(abs) : formatInt(abs);
  return { dir, text: dir === 'tetap' ? 'tetap' : `${dir} ${amount}` };
}

/**
 * One number, its direction and a small line. Also what a chart with a single data point becomes:
 * a picture of one point says nothing. The change is written in words ("naik 8%") with an arrow,
 * so it does not depend on colour, and it is not red or green: those are status colours.
 */
export function StatTile({ label, value, delta, values, hint, className }: StatTileProps): React.ReactElement {
  const d = delta ? deltaText(delta) : null;
  return (
    <div className={['ds-chart', 'ds-chart-tile', className ?? ''].filter(Boolean).join(' ')}>
      <ChartStyles />
      <span className="ds-chart-tile-label">{label}</span>
      <div className="ds-chart-tile-row">
        <span className="ds-chart-tile-value">{value}</span>
        {values && values.length >= 2 && <Sparkline values={values} label={`Tren ${label}`} />}
      </div>
      {d && delta && (
        <span className="ds-chart-tile-delta">
          <Arrow dir={d.dir} />
          <b>{d.text}</b>
          {delta.label && <span>{delta.label}</span>}
        </span>
      )}
      {hint && <span className="ds-chart-hint">{hint}</span>}
    </div>
  );
}

export interface MarginTileProps {
  label: string;
  /** Integer percent, 0 to 100 (a negative margin draws an empty bar and still writes the number). */
  percent: number;
  /** Written beside it: `Laba bersih Rp2.980.000`. */
  amount?: string;
  hint?: string;
  className?: string;
}

/** A percentage with a bar that fills to it, and the amount it comes from written below. */
export function MarginTile({ label, percent, amount, hint, className }: MarginTileProps): React.ReactElement {
  const fill = clamp(percent, 0, 100);
  return (
    <div className={['ds-chart', 'ds-chart-tile', className ?? ''].filter(Boolean).join(' ')}>
      <ChartStyles />
      <span className="ds-chart-tile-label">{label}</span>
      <span className="ds-chart-tile-value">{formatPercent(percent)}</span>
      <svg width="100%" height="8" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-valuetext={formatPercent(percent)}>
        <rect x="0" y="0" width="100%" height="8" rx="4" style={{ fill: 'rgb(var(--ds-chart-track))' }} />
        {fill > 0 && <rect x="0" y="0" width={`${fill}%`} height="8" rx="4" style={{ fill: slotColor(1) }} />}
      </svg>
      {amount && <span className="ds-chart-tile-delta"><b>{amount}</b></span>}
      {hint && <span className="ds-chart-hint">{hint}</span>}
    </div>
  );
}
