import { useEffect, useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import { Alert, SegmentedControl, Skeleton } from '@umkmall/ui/primitives'
import { loadDashboard, rupiah, type Dashboard, type Metrics, type Period } from './-api'
import { change } from './-reports'

// U5 dashboard widgets, rendered by the dashboard page on `/` (owned by the UI parity slice) with one line.

const PERIODS: { value: Period; label: string; previous: string }[] = [
  { value: 'today', label: 'Hari ini', previous: 'kemarin' },
  { value: 'week', label: 'Minggu ini', previous: 'minggu lalu' },
  { value: 'month', label: 'Bulan ini', previous: 'bulan lalu' },
  { value: 'year', label: 'Tahun ini', previous: 'tahun lalu' },
]

const WIDGETS: { key: keyof Metrics; label: string; money: boolean }[] = [
  { key: 'revenue', label: 'Pendapatan', money: true },
  { key: 'salesCount', label: 'Transaksi', money: false },
  { key: 'grossProfit', label: 'Laba kotor', money: true },
]

type State = { status: 'loading' } | { status: 'hidden' } | { status: 'error'; error: string } | { status: 'ok'; data: Dashboard }

/** Revenue, sales count and gross profit vs the same span of the previous period. Hidden without `reports.view`. */
export function MetricWidgets() {
  const [period, setPeriod] = useState<Period>('today')
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    loadDashboard({ data: period })
      .then((r) => {
        if (!live) return
        if (r.ok) setState({ status: 'ok', data: r.data })
        else setState(r.status === 403 ? { status: 'hidden' } : { status: 'error', error: r.error })
      })
      .catch(() => live && setState({ status: 'error', error: 'Gagal memuat ringkasan, coba lagi.' }))
    return () => {
      live = false
    }
  }, [period])

  if (state.status === 'hidden') return null
  const prevLabel = PERIODS.find((p) => p.value === period)!.previous
  return (
    <section aria-label="Ringkasan penjualan" className="space-y-3">
      <SegmentedControl aria-label="Periode" options={PERIODS} value={period} onChange={setPeriod} />
      {state.status === 'error' && <Alert variant="danger">{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        {WIDGETS.map((w) => (
          <Card key={w.key} variant="outlined" padding="medium">
            <p className="text-sm text-default-secondary">{w.label}</p>
            {state.status === 'ok' ? (
              <Stat value={state.data.current[w.key]} previous={state.data.previous[w.key]} money={w.money} prevLabel={prevLabel} />
            ) : state.status === 'loading' ? (
              <>
                <p className="sr-only" role="status">Memuat…</p>
                <Skeleton shape="text" className="mt-2 h-8 w-32" />
                <Skeleton shape="text" className="mt-2 h-4 w-40" />
              </>
            ) : (
              <p className="mt-2 text-2xl font-semibold text-default-secondary">–</p>
            )}
          </Card>
        ))}
      </div>
    </section>
  )
}

function Stat({ value, previous, money, prevLabel }: { value: number; previous: number; money: boolean; prevLabel: string }) {
  const fmt = (n: number) => (money ? rupiah(n) : n.toLocaleString('id-ID'))
  const pct = change(value, previous)
  return (
    <>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-default-primary">{fmt(value)}</p>
      <p className="mt-1 text-sm text-default-secondary">
        {pct === null ? (
          <>Belum ada data {prevLabel}</>
        ) : (
          <>
            <span className={pct >= 0 ? 'text-success' : 'text-error'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</span> dari {fmt(previous)} {prevLabel}
          </>
        )}
      </p>
    </>
  )
}
