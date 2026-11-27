import { Link } from '@tanstack/react-router'
import {
  BarChart,
  ChartFrame,
  DonutChart,
  formatRupiah,
  HeatStrip,
  MarginTile,
  Meter,
  MeterList,
  SegmentedBar,
  StatTile,
  Button,
  type ChartState,
} from '@umkmall/ui/primitives'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { showError } from '@/lib/feedback'
import { useCan } from '@/components/shell'
import { ActionRow } from '@/components/action-row'
import { Panel } from '@/components/page'
import { loadSummary, type SummaryKind, type SummaryKinds } from './-api'
import {
  allZero,
  clip,
  monthName,
  setupProgress,
  showSetupBoard,
  usedPercent,
  voucherStatus,
  weekday,
  withMoney,
} from './-summary'

// The picture summaries above each menu's list (design feature 39). Each panel loads on its own, so a failed one
// never blocks the list under it: it shows a clear message with "Muat ulang" in place, quietly (no error dialog
// over a list that works). The numbers come first (StatTile), then charts from the @umkmall/ui chart standard; the
// table stays below.

type Loaded<K extends SummaryKind> =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: SummaryKinds[K] }

/**
 * Loads one summary when the panel shows, again on "Muat ulang". A failure opens the error dialog once, unless
 * `quiet` (the caller shows the failure in place).
 */
export function useSummary<K extends SummaryKind>(kind: K, quiet = false): { loaded: Loaded<K>; reload: () => void } {
  const [loaded, setLoaded] = useState<Loaded<K>>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => {
    setLoaded({ state: 'loading' })
    setTick((t) => t + 1)
  }, [])
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    let live = true
    loadSummary({ data: kind })
      .then((res) => {
        if (!live) return
        if (res.ok)
          return setLoaded({
            state: 'ready',
            data: res.data as SummaryKinds[K],
          })
        setLoaded({ state: 'error' })
        if (!quiet)
          showError(res, {
            action: 'memuat ringkasan',
            retry: () => reloadRef.current(),
            fallback: 'Ringkasan belum bisa dimuat.',
          })
      })
      .catch(() => {
        if (!live) return
        setLoaded({ state: 'error' })
        if (!quiet)
          showError({ status: 0, offline: true }, { action: 'memuat ringkasan', retry: () => reloadRef.current() })
      })
    return () => {
      live = false
    }
  }, [kind, tick, quiet])
  return { loaded, reload }
}

const rp = (n: number) => formatRupiah(n)
const pcs = (n: number) => `${n.toLocaleString('id-ID')} pcs`
const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-4 md:grid-cols-2">{children}</div>
const Tiles = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
)

/**
 * The frame of a summary: while loading a skeleton as large as the pictures, on failure the message and
 * "Muat ulang" (the list under it stays usable), otherwise the content. A user without the menu's
 * permission gets nothing: the list's own page says why.
 */
function Shell<K extends SummaryKind>({
  kind,
  permission,
  title,
  children,
}: {
  kind: K
  permission: string
  title: string
  children: (data: SummaryKinds[K]) => ReactNode
}) {
  const can = useCan(permission)
  if (!can) return null
  return (
    <ShellInner kind={kind} title={title}>
      {children}
    </ShellInner>
  )
}

function ShellInner<K extends SummaryKind>({
  kind,
  title,
  children,
}: {
  kind: K
  title: string
  children: (data: SummaryKinds[K]) => ReactNode
}) {
  const { loaded, reload } = useSummary(kind, true)
  if (loaded.state !== 'ready')
    return (
      <section aria-label={title}>
        <ChartFrame
          boxed
          title={title}
          state={loaded.state}
          onRetry={reload}
          height={180}
          loadingText="Memuat ringkasan"
          errorText="Ringkasan tidak bisa dimuat. Daftar di bawah tetap bisa dipakai."
        />
      </section>
    )
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      {children(loaded.data)}
    </section>
  )
}

const state = (empty: boolean): ChartState => (empty ? 'empty' : 'ready')
const EMPTY = 'Gambar muncul setelah ada data'

export function SalesHistorySummary() {
  return (
    <Shell kind="sales-history" permission="reports.view" title="Ringkasan penjualan">
      {(d) => (
        <>
          <Tiles>
            <StatTile label="Struk hari ini" value={d.today.count.toLocaleString('id-ID')} />
            <StatTile label="Total hari ini" value={rp(d.today.total)} />
          </Tiles>
          <Grid>
            <BarChart
              boxed
              title="Penjualan 7 hari"
              unit="rupiah"
              categories={d.days.map((x) => weekday(x.date))}
              series={[{ label: 'Penjualan', values: d.days.map((x) => x.total) }]}
              state={state(allZero(d.days.map((x) => x.total)))}
              emptyText={EMPTY}
            />
            <SegmentedBar
              boxed
              title="Cara bayar hari ini"
              unit="rupiah"
              parts={d.methods.map((m) => ({ label: m.name, value: m.amount }))}
              state={state(d.methods.length === 0)}
              emptyText={EMPTY}
            />
          </Grid>
        </>
      )}
    </Shell>
  )
}

export function MembersSummary() {
  return (
    <Shell kind="members" permission="members.manage" title="Ringkasan pelanggan">
      {(d) => {
        const money = withMoney(d.top)
        return (
          <>
            <Tiles>
              <StatTile label="Pelanggan" value={d.total.toLocaleString('id-ID')} />
              {d.kasbonRest !== null && <StatTile label="Kasbon berjalan" value={rp(d.kasbonRest)} />}
            </Tiles>
            <Grid>
              <BarChart
                boxed
                title="Pelanggan terbesar bulan ini"
                unit={money ? 'rupiah' : 'count'}
                orientation="horizontal"
                categories={d.top.map((x) => x.name)}
                series={[
                  money
                    ? { label: 'Belanja', values: d.top.map((x) => x.amount ?? 0) }
                    : { label: 'Struk', values: d.top.map((x) => x.receipts) },
                ]}
                state={state(d.top.length === 0)}
                emptyText={EMPTY}
              />
              <SegmentedBar
                boxed
                title="Baru dan kembali bulan ini"
                unit="count"
                parts={[
                  { label: 'Kembali', value: d.returningCount },
                  { label: 'Baru', value: d.newCount },
                ]}
                state={state(d.returningCount + d.newCount === 0)}
                emptyText={EMPTY}
              />
            </Grid>
          </>
        )
      }}
    </Shell>
  )
}

export function ProductsSummary() {
  return (
    <Shell kind="products" permission="catalog.manage" title="Ringkasan produk">
      {(d) => (
        <>
          <Tiles>
            <StatTile label="Produk" value={d.total.toLocaleString('id-ID')} />
            <StatTile
              label="Perlu perhatian"
              value={d.attention.toLocaleString('id-ID')}
              hint="Stok menipis atau habis"
            />
            {d.noCost !== null && d.noCost > 0 && (
              <StatTile
                label="Tanpa harga beli"
                value={d.noCost.toLocaleString('id-ID')}
                hint="Laba tidak bisa dihitung"
              />
            )}
          </Tiles>
          <Grid>
            <SegmentedBar
              boxed
              title="Status stok"
              unit="count"
              parts={[
                { label: 'Aman', value: d.stock.ok },
                { label: 'Menipis', value: d.stock.low },
                { label: 'Habis', value: d.stock.out },
              ]}
              state={state(d.total === 0)}
              emptyText={EMPTY}
            />
            {d.margins !== null && (
              <BarChart
                boxed
                title="Margin tertinggi"
                unit="percent"
                orientation="horizontal"
                categories={d.margins.map((x) => clip(x.name))}
                series={[{ label: 'Margin', values: d.margins.map((x) => x.percent) }]}
                state={state(d.margins.length === 0)}
                emptyText={EMPTY}
              />
            )}
          </Grid>
        </>
      )}
    </Shell>
  )
}

export function CategoriesSummary() {
  return (
    <Shell kind="categories" permission="catalog.manage" title="Ringkasan kategori">
      {(d) => {
        const hasMoney = d.categories.some((c) => c.revenue !== null)
        return (
          <Grid>
            {hasMoney ? (
              <DonutChart
                boxed
                title="Porsi omzet bulan ini"
                unit="rupiah"
                parts={d.categories
                  .filter((c) => (c.revenue ?? 0) > 0)
                  .map((c) => ({ label: c.name, value: c.revenue ?? 0 }))}
                state={state(!d.categories.some((c) => (c.revenue ?? 0) > 0))}
                emptyText={EMPTY}
              />
            ) : null}
            <BarChart
              boxed
              title={hasMoney ? 'Nilai stok per kategori' : 'Produk per kategori'}
              unit={hasMoney ? 'rupiah' : 'count'}
              orientation="horizontal"
              categories={d.categories.map((c) => clip(c.name))}
              series={[
                {
                  label: hasMoney ? 'Nilai stok' : 'Produk',
                  values: d.categories.map((c) => (hasMoney ? (c.stockValue ?? 0) : c.products)),
                },
              ]}
              state={state(allZero(d.categories.map((c) => (hasMoney ? (c.stockValue ?? 0) : c.products))))}
              emptyText={EMPTY}
            />
          </Grid>
        )
      }}
    </Shell>
  )
}

export function PaymentMethodsSummary() {
  return (
    <Shell kind="payment-methods" permission="catalog.manage" title="Ringkasan metode pembayaran">
      {(d) => (
        <>
          <Tiles>
            <StatTile label="Metode aktif" value={d.activeCount.toLocaleString('id-ID')} />
          </Tiles>
          <SegmentedBar
            boxed
            title="Porsi pemakaian bulan ini"
            unit={withMoney(d.methods) ? 'rupiah' : 'count'}
            parts={d.methods.map((m) => ({ label: m.name, value: m.amount ?? m.uses }))}
            state={state(d.methods.length === 0)}
            emptyText={EMPTY}
          />
        </>
      )}
    </Shell>
  )
}

export function StockOpnameSummary() {
  return (
    <Shell kind="stock-opname" permission="purchasing.manage" title="Ringkasan stok opname">
      {(d) =>
        d.opname === null ? (
          <ChartFrame
            boxed
            title="Selisih stok opname terakhir"
            state="empty"
            emptyText="Belum ada stok opname yang disetujui"
          />
        ) : (
          <>
            <Tiles>
              <StatTile label="Selisih kurang" value={pcs(d.shortQty)} />
              <StatTile label="Selisih lebih" value={pcs(d.overQty)} />
              {d.shortValue !== null && <StatTile label="Nilai selisih kurang" value={rp(d.shortValue)} />}
            </Tiles>
            <BarChart
              boxed
              title="Selisih per produk"
              description="Opname terakhir yang disetujui. Batang dari nol: ke kiri kurang, ke kanan lebih."
              unit="count"
              orientation="horizontal"
              categories={d.lines.map((x) => clip(x.name))}
              series={[{ label: 'Selisih (pcs)', values: d.lines.map((x) => x.diff) }]}
              state={state(d.lines.length === 0)}
              emptyText="Stok sama dengan hitungan, tidak ada selisih"
            />
          </>
        )
      }
    </Shell>
  )
}

export function VouchersSummary() {
  return (
    <Shell kind="vouchers" permission="vouchers.manage" title="Ringkasan voucher">
      {(d) => (
        <Grid>
          <MeterList
            boxed
            title="Pemakaian kuota"
            emptyText="Belum ada voucher yang berlaku"
            state={state(d.vouchers.length === 0)}
            items={d.vouchers.map((v) => ({
              label: clip(v.name),
              value: v.used,
              max: Math.max(1, v.quota),
              status: voucherStatus(v.used, v.quota),
            }))}
            description={
              d.vouchers.some((v) => usedPercent(v.used, v.quota) >= 90)
                ? 'Ada voucher yang hampir habis kuotanya.'
                : undefined
            }
          />
          <BarChart
            boxed
            title="Penebusan 7 hari"
            unit="count"
            categories={d.days.map((x) => weekday(x.date))}
            series={[{ label: 'Penebusan', values: d.days.map((x) => x.count) }]}
            state={state(allZero(d.days.map((x) => x.count)))}
            emptyText={EMPTY}
          />
        </Grid>
      )}
    </Shell>
  )
}

export function StaffSummary() {
  return (
    <Shell kind="staff" permission="staff.manage" title="Ringkasan staf">
      {(d) => {
        const money = withMoney(d.cashiers)
        return (
          <Grid>
            <BarChart
              boxed
              title={money ? 'Penjualan per kasir bulan ini' : 'Struk per kasir bulan ini'}
              unit={money ? 'rupiah' : 'count'}
              orientation="horizontal"
              categories={d.cashiers.map((c) => clip(c.name))}
              series={[
                money
                  ? { label: 'Penjualan', values: d.cashiers.map((c) => c.amount ?? 0) }
                  : { label: 'Struk', values: d.cashiers.map((c) => c.receipts) },
              ]}
              state={state(d.cashiers.length === 0)}
              emptyText={EMPTY}
            />
            <HeatStrip
              boxed
              title="Jam sibuk bulan ini"
              valueLabel="struk"
              values={d.hours}
              labels={d.hours.map((_, h) => String(h).padStart(2, '0'))}
              state={state(allZero(d.hours))}
              emptyText={EMPTY}
            />
          </Grid>
        )
      }}
    </Shell>
  )
}

export function SuppliersSummary() {
  return (
    <Shell kind="suppliers" permission="purchasing.manage" title="Ringkasan pemasok">
      {(d) => (
        <>
          <Tiles>
            <StatTile label="Pemasok" value={d.supplierCount.toLocaleString('id-ID')} />
          </Tiles>
          <BarChart
            boxed
            title="Pembelian 6 bulan"
            unit="rupiah"
            categories={d.months.map((m) => monthName(m.month))}
            series={[{ label: 'Pembelian', values: d.months.map((m) => m.total) }]}
            state={state(allZero(d.months.map((m) => m.total)))}
            emptyText={EMPTY}
          />
        </>
      )}
    </Shell>
  )
}

/**
 * "Kelengkapan toko" on Pengaturan: the steps done and not yet; it hides itself once every step is done. A change
 * of `refresh` (a form on the page saved) reads the steps again.
 */
export function SetupBoard({ refresh = 0 }: { refresh?: number }) {
  const can = useCan('catalog.manage')
  if (!can) return null
  return <SetupBoardInner refresh={refresh} />
}

function SetupBoardInner({ refresh }: { refresh: number }) {
  // Quiet like the menu panels: a board that fails shows it in place, above forms that still work.
  const { loaded, reload } = useSummary('setup', true)
  const seen = useRef(refresh)
  useEffect(() => {
    if (seen.current === refresh) return
    seen.current = refresh
    reload()
  }, [refresh, reload])
  if (loaded.state === 'loading') return <ChartFrame boxed title="Kelengkapan toko" state="loading" height={120} />
  if (loaded.state === 'error')
    return (
      <ChartFrame
        boxed
        title="Kelengkapan toko"
        state="error"
        onRetry={reload}
        height={120}
        errorText="Kelengkapan toko tidak bisa dimuat."
      />
    )
  if (!showSetupBoard(loaded.data)) return null
  const { steps, doneCount } = loaded.data
  return (
    <Panel className="flex flex-col gap-4 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold text-default-primary">Kelengkapan toko</h2>
        <p className="text-sm text-default-secondary">{setupProgress(doneCount, steps.length)}</p>
      </div>
      <Meter label="Langkah selesai" value={doneCount} max={steps.length} />
      <ul className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-default-primary">
              <span aria-hidden>{s.done ? '✓ ' : '○ '}</span>
              {s.label}
              <span className="sr-only">{s.done ? ': selesai' : ': belum diatur'}</span>
            </span>
            {s.done ? (
              <span className="text-sm text-default-secondary">Selesai</span>
            ) : (
              <ActionRow className="sm:w-auto">
                <Button type="outline" color="primary" size="small" width="auto" asChild>
                  <Link to={s.to}>Atur sekarang</Link>
                </Button>
              </ActionRow>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * The cashier's finished receipt: today's progress against the owner's target, as a percent only (a cashier may not
 * see the store's takings). Nothing at all when no target is set.
 */
export function DailyTargetCard() {
  // Quiet: the receipt is done and paid; a target that cannot load is simply not shown, without a dialog.
  const { loaded } = useSummary('daily-target', true)
  if (loaded.state !== 'ready' || !loaded.data.set || loaded.data.percent === null) return null
  return <MarginTile label="Target harian" percent={loaded.data.percent} hint="Penjualan hari ini terhadap target" />
}
