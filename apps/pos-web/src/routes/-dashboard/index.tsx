import { SegmentedControl } from '@umkmall/ui/primitives'
import { useCallback, useRef, useState } from 'react'
import { showError, type FailureLike } from '@/lib/feedback'
import { SCROLL_ROW } from '@/lib/scroll-row'
import {
  AgingCard,
  ExpensesCard,
  Headline,
  HourlyCard,
  LowStockCard,
  PaymentCard,
  TopProductsCard,
  TrendCard,
  useOverview,
} from './cards'
import type { WidgetContext } from './use-widget'
import { PERIODS, type Period } from './wording'

/**
 * The dashboard's widgets (design feature 35): the headline figures and a chart card each. Mounted only for an actor
 * holding `reports.view`. The period control moves the headline and the trend; the other cards are fixed as in the design.
 * Each card loads and fails on its own; the first failure of a round opens the shared error dialog, whose "Coba lagi"
 * asks every card again.
 */
export function DashboardWidgets() {
  const [period, setPeriod] = useState<Period>('today')
  const [version, setVersion] = useState(0)
  const shownFor = useRef(-1)
  const versionRef = useRef(0)
  versionRef.current = version
  const reloadAll = useCallback(() => setVersion((v) => v + 1), [])
  const fail = useCallback(
    (failure: FailureLike, action: string) => {
      if (shownFor.current === versionRef.current) return
      shownFor.current = versionRef.current
      showError(failure, {
        action: 'memuat widget',
        retry: reloadAll,
        fallback: `Gagal ${action}.`,
      })
    },
    [reloadAll],
  )
  const ctx: WidgetContext = { version, fail }
  const overview = useOverview(ctx, period)
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl aria-label="Periode" className={SCROLL_ROW} options={PERIODS} value={period} onChange={setPeriod} />
      <Headline overview={overview} period={period} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TrendCard overview={overview} period={period} />
        <HourlyCard ctx={ctx} />
        <PaymentCard ctx={ctx} />
        <TopProductsCard ctx={ctx} />
        <LowStockCard ctx={ctx} />
        <AgingCard ctx={ctx} />
        <ExpensesCard ctx={ctx} />
      </div>
    </div>
  )
}
