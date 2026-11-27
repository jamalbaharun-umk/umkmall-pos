import { join } from 'node:path';
import type { Visual } from '../visuals/types';
import {
  inlineSvg,
  parseLegend,
  type InlinedSvg,
  type LegendEntry,
} from './svg-inline';

interface ChartsBundle {
  css: string;
  renderChartHtml: (spec: unknown, width: number, height: number) => string;
}

let bundle: ChartsBundle | undefined;
function charts(): ChartsBundle {
  // Built by scripts/bundle-charts.mjs (npm run build, the test setup and the Dockerfile): the @umkmall/ui chart
  // components with React inside. From src/ and from dist/ the path is the same, apps/pos-api/generated.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (bundle ??= require(
    join(__dirname, '..', '..', '..', 'generated', 'charts.cjs'),
  ) as ChartsBundle);
}

export interface RenderedChart extends InlinedSvg {
  legend: LegendEntry[];
}

/**
 * Draws a visual with the very components the screen uses, at an explicit size (they are SSR safe), and returns
 * the SVG with its colours resolved (null when the component draws a figure tile instead of a picture). `width` is in CSS px; a PDF draws a px as 0.75 pt.
 */
export function renderChart(
  visual: Visual,
  width: number,
  height = 220,
): RenderedChart | null {
  const { css, renderChartHtml } = charts();
  const html = renderChartHtml(visual, width, height);
  // A column chart of one value is drawn as a figure tile by the component (no picture to draw).
  if (!html.includes('<svg')) return null;
  return { ...inlineSvg(html, css), legend: parseLegend(html, css) };
}
