import React from 'react';

/**
 * Chart tokens and styles.
 *
 * Every colour is a channel variable of the design system (`--brand-b400`, `--neutral-n200`, ...,
 * from `tokens.css`), re-exposed as `--ds-chart-*` so a chart has ONE place to change. The
 * palette is the primary ramp plus grey (owner standard 2026-11-26): status colours (red,
 * yellow, green) appear only in `--ds-chart-status-*`, used by `Meter` for a stock status.
 *
 * These are named `--ds-chart-*`, not `--chart-*`: the admin theme (`app.css`) already defines
 * shadcn's `--chart-1..5` as oklch colours, and a channel triplet cannot share a name with those.
 *
 * Dark: under an ancestor with class `dark` or `data-theme="dark"`, with its own steps (not the
 * light ones inverted).
 *
 * The CSS is a string, rendered by `ChartStyles` (a hoisted, de-duplicated `<style>` in React 19),
 * so a chart rendered on the server for a PDF carries its own styles. The page must load
 * `tokens.css` as every @umkmall/ui page does.
 */

/** A categorical slot: the fixed colour order of a data kind. 4 is dark grey, `other` is "Lainnya". */
export type ChartSlot = 1 | 2 | 3 | 4 | 'other' | 'neg';

export const CATEGORICAL_SLOTS: ChartSlot[] = [1, 2, 3, 4, 'other'];

/** The token names a chart defines, light and dark. Guarded by a test. */
export const CHART_TOKEN_NAMES: readonly string[] = [
  '--ds-chart-1',
  '--ds-chart-2',
  '--ds-chart-3',
  '--ds-chart-4',
  '--ds-chart-other',
  '--ds-chart-neg',
  '--ds-chart-seq-1',
  '--ds-chart-seq-2',
  '--ds-chart-seq-3',
  '--ds-chart-seq-4',
  '--ds-chart-seq-5',
  '--ds-chart-grid',
  '--ds-chart-axis',
  '--ds-chart-text',
  '--ds-chart-track',
  '--ds-chart-surface',
  '--ds-chart-status-bad',
  '--ds-chart-status-warn',
  '--ds-chart-status-ok',
];

export function slotColor(slot: ChartSlot): string {
  return `rgb(var(--ds-chart-${slot}))`;
}

/** Step 1 to 5 of the single-colour ramp, for ordered data (ageing, heat). */
export function seqColor(step: number): string {
  return `rgb(var(--ds-chart-seq-${Math.min(5, Math.max(1, step))}))`;
}

export function slotAt(index: number): ChartSlot {
  return CATEGORICAL_SLOTS[Math.min(index, CATEGORICAL_SLOTS.length - 1)];
}

const LIGHT = `
  --ds-chart-1: var(--brand-b400);
  --ds-chart-2: var(--brand-b600);
  --ds-chart-3: var(--brand-b200);
  --ds-chart-4: var(--neutral-n200);
  --ds-chart-other: var(--neutral-n100);
  --ds-chart-neg: var(--neutral-n100);
  --ds-chart-seq-1: var(--brand-b100);
  --ds-chart-seq-2: var(--brand-b200);
  --ds-chart-seq-3: var(--brand-b300);
  --ds-chart-seq-4: var(--brand-b400);
  --ds-chart-seq-5: var(--brand-b600);
  --ds-chart-grid: var(--neutral-n40);
  --ds-chart-axis: var(--neutral-n200);
  --ds-chart-text: var(--neutral-n400);
  --ds-chart-track: var(--neutral-n30);
  --ds-chart-surface: var(--neutral-n0);
  --ds-chart-status-bad: var(--red-r450);
  --ds-chart-status-warn: var(--yellow-y500);
  --ds-chart-status-ok: var(--green-g400);`;

const DARK = `
  --ds-chart-1: var(--brand-b300);
  --ds-chart-2: var(--brand-b100);
  --ds-chart-3: var(--brand-b400);
  --ds-chart-4: var(--neutral-n100);
  --ds-chart-other: var(--neutral-n200);
  --ds-chart-neg: var(--neutral-n200);
  --ds-chart-seq-1: var(--brand-b500);
  --ds-chart-seq-2: var(--brand-b400);
  --ds-chart-seq-3: var(--brand-b300);
  --ds-chart-seq-4: var(--brand-b200);
  --ds-chart-seq-5: var(--brand-b100);
  --ds-chart-grid: var(--neutral-n300);
  --ds-chart-axis: var(--neutral-n100);
  --ds-chart-text: var(--neutral-n10);
  --ds-chart-track: var(--neutral-n300);
  --ds-chart-surface: var(--neutral-n400);
  --ds-chart-status-bad: var(--red-r200);
  --ds-chart-status-warn: var(--yellow-y200);
  --ds-chart-status-ok: var(--green-g300);`;

export const CHART_TOKENS_LIGHT = LIGHT;
export const CHART_TOKENS_DARK = DARK;

/** All chart CSS. Type sizes are rem so the text-size setting reaches them. */
export const CHART_CSS = `
.ds-chart{${LIGHT}
  color:rgb(var(--ds-chart-text));font-variant-numeric:tabular-nums;box-sizing:border-box;min-width:0}
.dark .ds-chart,[data-theme="dark"] .ds-chart{${DARK}}
.ds-chart *,.ds-chart *::before,.ds-chart *::after{box-sizing:border-box}
.ds-chart-boxed{border:1px solid rgb(var(--ds-chart-grid));border-radius:0.75rem;background:rgb(var(--ds-chart-surface));padding:1rem}
.ds-chart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;margin-bottom:0.5rem}
.ds-chart-title{margin:0;font-size:0.875rem;line-height:1.25rem;font-weight:700}
.ds-chart-desc{margin:0;font-size:0.75rem;line-height:1rem;color:rgb(var(--ds-chart-axis))}
.ds-chart-btn{flex:none;appearance:none;border:1px solid rgb(var(--ds-chart-grid));background:transparent;color:rgb(var(--ds-chart-1));font:inherit;font-size:0.75rem;font-weight:600;border-radius:0.625rem;padding:0 0.75rem;min-height:2.25rem;cursor:pointer}
.ds-chart-btn:focus-visible{outline:2px solid rgb(var(--ds-chart-1));outline-offset:2px}
@media (pointer:coarse){.ds-chart-btn{min-height:2.75rem}}
.ds-chart-plot{position:relative;width:100%}
.ds-chart-scroll{overflow-x:auto;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.ds-chart-inner{position:relative}
.ds-chart svg{display:block;overflow:visible;max-width:none}
.ds-chart-t{fill:rgb(var(--ds-chart-axis));font-size:0.75rem}
.ds-chart-v{fill:rgb(var(--ds-chart-text));font-size:0.75rem;font-weight:600}
.ds-chart-c{fill:rgb(var(--ds-chart-text));font-size:1.125rem;font-weight:700}
.ds-chart-grid{stroke:rgb(var(--ds-chart-grid));stroke-width:1}
.ds-chart-zero{stroke:rgb(var(--ds-chart-axis));stroke-width:1}
.ds-chart-hit{fill:transparent;cursor:default}
.ds-chart [data-datum]{outline:none}
.ds-chart [data-datum]:focus-visible .ds-chart-ring{stroke:rgb(var(--ds-chart-text));stroke-width:2}
.ds-chart-ring{fill:none;stroke:none}
.ds-chart-tip{position:absolute;z-index:2;pointer-events:none;transform:translate(-50%,-100%);margin-top:-0.5rem;min-width:7rem;max-width:14rem;padding:0.375rem 0.625rem;border-radius:0.5rem;background:rgb(var(--ds-chart-text));color:rgb(var(--ds-chart-surface));font-size:0.75rem;line-height:1rem;box-shadow:0 2px 8px rgb(var(--ds-chart-text) / 0.25)}
.ds-chart-tip b{display:block;font-weight:700}
.ds-chart-tip div{display:flex;justify-content:space-between;gap:0.75rem}
.ds-chart-legend{display:flex;flex-wrap:wrap;gap:0.375rem 1rem;margin:0.75rem 0 0;padding:0;list-style:none;font-size:0.75rem;line-height:1rem}
.ds-chart-legend li{display:flex;align-items:center;gap:0.5rem;min-width:0}
.ds-chart-legend-rows{flex-direction:column;flex-wrap:nowrap;gap:0.5rem}
.ds-chart-legend-rows li{width:100%}
.ds-chart-sw{flex:none;width:0.75rem;height:0.75rem;border-radius:0.25rem}
.ds-chart-legend-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ds-chart-legend-value{flex:none;font-weight:600;white-space:nowrap}
.ds-chart-legend-pct{flex:none;width:2.5rem;text-align:right;color:rgb(var(--ds-chart-axis));white-space:nowrap}
.ds-chart-tablewrap{margin-top:0.75rem;overflow-x:auto;border:1px solid rgb(var(--ds-chart-grid));border-radius:0.625rem}
.ds-chart-table{width:100%;border-collapse:collapse;font-size:0.75rem}
.ds-chart-table caption{padding:0.5rem 0.75rem;text-align:left;font-weight:700}
.ds-chart-table th,.ds-chart-table td{padding:0.375rem 0.75rem;border-top:1px solid rgb(var(--ds-chart-grid));text-align:right;white-space:nowrap}
.ds-chart-table th:first-child,.ds-chart-table td:first-child{text-align:left;white-space:normal}
.ds-chart-table th{color:rgb(var(--ds-chart-axis));font-weight:600}
.ds-chart-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;padding:1rem;text-align:center;border-radius:0.75rem;font-size:0.875rem}
.ds-chart-empty{border:1px dashed rgb(var(--ds-chart-axis))}
.ds-chart-hint{font-size:0.75rem;color:rgb(var(--ds-chart-axis))}
.ds-chart-skel{border-radius:0.75rem;background:rgb(var(--ds-chart-track))}
@media (prefers-reduced-motion:no-preference){.ds-chart-skel{animation:ds-chart-pulse 1.4s ease-in-out infinite}}
@keyframes ds-chart-pulse{0%,100%{opacity:1}50%{opacity:0.55}}
.ds-chart-tile{display:flex;flex-direction:column;gap:0.25rem;min-width:0;padding:0.75rem 1rem;border:1px solid rgb(var(--ds-chart-grid));border-radius:0.75rem;background:rgb(var(--ds-chart-surface))}
.ds-chart-tile-label{font-size:0.75rem;color:rgb(var(--ds-chart-axis))}
.ds-chart-tile-row{display:flex;align-items:flex-end;justify-content:space-between;gap:0.75rem}
.ds-chart-tile-value{font-size:1.5rem;line-height:2rem;font-weight:700;white-space:nowrap}
.ds-chart-tile-delta{display:flex;align-items:center;gap:0.25rem;font-size:0.75rem;color:rgb(var(--ds-chart-axis))}
.ds-chart-tile-delta b{color:rgb(var(--ds-chart-text))}
.ds-chart-meter{display:flex;flex-direction:column;gap:0.25rem}
.ds-chart-meter-head{display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;font-size:0.8125rem}
.ds-chart-meter-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.ds-chart-meter-val{flex:none;font-size:0.75rem;color:rgb(var(--ds-chart-axis))}
.ds-chart-badge{flex:none;font-size:0.6875rem;font-weight:700;padding:0 0.5rem;border-radius:999px;border:1px solid currentColor}
.ds-chart-meters{display:flex;flex-direction:column;gap:0.875rem;margin:0;padding:0;list-style:none}
.ds-chart-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;

/**
 * The chart styles. React 19 hoists and de-duplicates a `<style href precedence>`, so every chart
 * can render this and the page gets one copy; `renderToString` writes it inline for a PDF.
 */
export function ChartStyles(): React.ReactElement {
  return (
    <style href="ds-chart-styles" precedence="medium">
      {CHART_CSS}
    </style>
  );
}
