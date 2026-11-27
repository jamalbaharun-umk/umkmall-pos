// Bundled by scripts/bundle-charts.mjs into generated/charts.cjs (esbuild, react and react-dom included), so
// pos-api draws the SAME chart components as the screen (@umkmall/ui Charts, vendored in packages/ui) with no
// runtime dependency on React. Plain JS on purpose: tsc never sees the UI package's sources.
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BarChart, SegmentedBar, CHART_CSS } from '../../../packages/ui/src/primitives/Charts/index.ts'

export const css = CHART_CSS

/** `spec` is one of the visual specs of src/reports/visuals/types.ts; `width` and `height` are explicit, in px. */
export function renderChartHtml(spec, width, height) {
  if (spec.kind === 'segments') {
    return renderToStaticMarkup(
      React.createElement(SegmentedBar, {
        title: spec.title,
        parts: spec.parts,
        unit: spec.unit,
        palette: spec.palette,
        width,
      }),
    )
  }
  return renderToStaticMarkup(
    React.createElement(BarChart, {
      title: spec.title,
      categories: spec.categories,
      series: spec.series,
      unit: spec.unit,
      orientation: spec.orientation,
      stacked: spec.stacked,
      sort: spec.sort,
      width,
      height,
    }),
  )
}
