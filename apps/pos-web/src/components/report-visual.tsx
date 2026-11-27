import { useEffect, useState } from 'react'
import { BarChart, ChartFrame, SegmentedBar } from '@umkmall/ui/primitives'
import { loadVisuals } from '@/routes/laporan/-visuals-api'
import { VISUAL_TITLES, visualIsEmpty, visualQuery, type Visual, type VisualKind } from '@/routes/laporan/-visuals'

/**
 * One report visual (design feature 38) drawn with the `@umkmall/ui` chart standard: primary-palette colours from the
 * chart tokens, exact figures in the legend and the table twin ("Lihat tabel"). pos-api decides what it shows and
 * computes every number; the server PDF draws the same visual with the same component.
 */
export function ReportVisual({ visual, emptyText = 'Belum ada data pada periode ini.' }: { visual: Visual; emptyText?: string }) {
  const state = visualIsEmpty(visual) ? 'empty' : 'ready'
  if (visual.kind === 'segments')
    return (
      <SegmentedBar
        boxed
        title={visual.title}
        unit={visual.unit}
        palette={visual.palette}
        parts={visual.parts}
        categoryLabel={visual.categoryLabel}
        state={state}
        emptyText={emptyText}
      />
    )
  return (
    <BarChart
      boxed
      title={visual.title}
      unit={visual.unit}
      orientation={visual.orientation}
      stacked={visual.stacked}
      categories={visual.categories}
      series={visual.series}
      categoryLabel={visual.categoryLabel}
      state={state}
      emptyText={emptyText}
    />
  )
}

/** The grid of visuals of one report: two columns from a desktop width, one on a phone. */
export function VisualGrid({ visuals }: { visuals: Visual[] }) {
  return (
    <section aria-label="Diagram laporan" className="grid gap-4 lg:grid-cols-2">
      {visuals.map((v) => (
        <ReportVisual key={v.id} visual={v} />
      ))}
    </section>
  )
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; visuals: Visual[] }

/**
 * Loads the visuals of a report (same range, period or filter as the screen) and draws them: skeletons while it
 * loads, and on failure a chart frame with the message and "Coba lagi" (never old figures). A failure here never
 * blocks the report's table and totals.
 */
export function ReportVisuals({ kind, query }: { kind: VisualKind; query: Record<string, string | undefined> }) {
  const [result, setResult] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const key = `${kind}?${visualQuery(query)}`
  useEffect(() => {
    let live = true
    setResult({ state: 'loading' })
    loadVisuals({ data: { kind, query: Object.fromEntries(new URLSearchParams(key.split('?')[1])) } })
      .then((r) => {
        if (live) setResult(r.ok ? { state: 'ready', visuals: r.visuals } : { state: 'error', message: r.error })
      })
      .catch(() => {
        if (live) setResult({ state: 'error', message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' })
      })
    return () => {
      live = false
    }
  }, [key, attempt, kind])
  if (result.state === 'ready') return <VisualGrid visuals={result.visuals} />
  return (
    <section aria-label="Diagram laporan" className="grid gap-4 lg:grid-cols-2">
      {VISUAL_TITLES[kind].map((t) => (
        <ChartFrame
          key={t}
          boxed
          title={t}
          state={result.state}
          height={160}
          errorText={result.state === 'error' ? `Diagram belum bisa dimuat. ${result.message}` : undefined}
          onRetry={() => setAttempt((n) => n + 1)}
          loadingText="Memuat diagram…"
        />
      ))}
    </section>
  )
}
