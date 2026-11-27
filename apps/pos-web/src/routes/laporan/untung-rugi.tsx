import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert, ProgressBar, SegmentedControl } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { Empty, Panel } from '@/components/page'
import { ReportVisuals } from '@/components/report-visual'
import { PdfButton } from './-pdf-button'
import { rangeLabel } from './-pdf'
import { asPeriod, barPercent, PERIODS, periodNoun, profitChangeText } from '../pengeluaran/-helpers'
import { loadProfitLoss, rupiah, type ProfitLoss } from './-api'
import { ReportError, ReportLayout, ReportPending } from './-ui'

export const Route = createFileRoute('/laporan/untung-rugi')({
  validateSearch: (s) => ({ period: asPeriod(s.period) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadProfitLoss({ data: deps.period }),
  component: ProfitLossPage,
  pendingComponent: ReportPending,
  errorComponent: () => <ReportError />,
})

function ProfitLossPage() {
  const result = Route.useLoaderData()
  const { period } = Route.useSearch()
  const navigate = useNavigate()
  if (!result.ok) return <ReportError message={result.error} />
  const r = result.data
  return (
    <ReportLayout
      title="Untung rugi"
      actions={<PdfButton jenis="untung-rugi" query={{ period }} label={rangeLabel(r.current.from, r.current.to)} />}
    >
      <SegmentedControl
        aria-label="Periode"
        className="max-w-md"
        options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        value={period}
        onChange={(value) => void navigate({ to: '/laporan/untung-rugi', search: { period: value } })}
      />
      <NetProfit r={r} period={period} />
      <ReportVisuals kind="profit-loss" query={{ period }} />
      <Formula r={r} />
      <TopExpenses r={r} period={period} />
    </ReportLayout>
  )
}

function NetProfit({ r, period }: { r: ProfitLoss; period: 'today' | 'week' | 'month' }) {
  const loss = r.current.netProfit < 0
  return (
    <Card variant="outlined" padding="medium" className={loss ? 'bg-weak-error' : 'bg-weak-success'}>
      <p className="text-sm text-default-secondary">Untung bersih {periodNoun(period)} (tanpa pajak)</p>
      <p className={`text-3xl font-bold ${loss ? 'text-default-error' : 'text-default-success'}`}>{money(r.current.netProfit)}</p>
      <p className="text-sm text-default-secondary">{profitChangeText(r.netProfitChange, period)}</p>
    </Card>
  )
}

/** Negative profit reads "−Rp1.000", never "Rp-1.000". */
const money = (n: number) => (n < 0 ? `−${rupiah(-n)}` : rupiah(n))

function Formula({ r }: { r: ProfitLoss }) {
  const c = r.current
  const l = r.labels
  const line = (label: string, value: number, opts: { bold?: boolean; minus?: boolean } = {}) => (
    <div className={`flex items-baseline justify-between gap-3 ${opts.bold ? 'font-semibold text-default-primary' : 'text-default-secondary'}`}>
      <span>{opts.minus ? `− ${label}` : label}</span>
      <span className="whitespace-nowrap tabular-nums">{money(value)}</span>
    </div>
  )
  return (
    <Card variant="outlined" padding="medium" className="flex max-w-xl flex-col gap-2">
      <h2 className="font-semibold text-default-primary">Cara hitungnya</h2>
      {line(l.revenue, c.revenue, { bold: true })}
      {line(l.cost, c.cost, { minus: true })}
      <hr className="border-default-primary" />
      {line(l.grossProfit, c.grossProfit, { bold: true })}
      {line(l.shrinkage, c.shrinkage, { minus: true })}
      {line(l.expenses, c.expenses, { minus: true })}
      <hr className="border-default-primary" />
      {line(l.netProfit, c.netProfit, { bold: true })}
      <p className="mt-2 text-xs text-default-secondary">
        Pajak ({money(c.tax)}) adalah uang titipan untuk disetor, jadi tidak dihitung sebagai hasil jualan maupun untung.
        Pembulatan tunai ({money(c.rounding)}) dan bayar pemasok ({money(c.supplierPayments)}) tidak dihitung di atas: modal barang
        sudah mencakup barang dari pemasok.
      </p>
      <p className="text-xs text-default-secondary">
        Susut stok adalah modal barang yang hilang menurut stok opname yang disetujui, dikurangi modal barang yang ternyata lebih pada periode yang sama (paling kecil Rp0). Karena dihitung untuk seluruh periode yang dipilih, susut stok dua periode yang dijumlahkan bisa berbeda dari susut stok gabungan keduanya.
      </p>
    </Card>
  )
}

function TopExpenses({ r, period }: { r: ProfitLoss; period: 'today' | 'week' | 'month' }) {
  const max = Math.max(0, ...r.topExpenses.map((e) => e.total))
  return (
    <Card variant="outlined" padding="medium" className="max-w-xl">
      <h2 className="mb-3 font-semibold text-default-primary">Pengeluaran terbesar</h2>
      {r.topExpenses.length === 0 ? (
        <Panel>
          <Empty title={`Belum ada pengeluaran ${periodNoun(period)}`}>Catat biaya supaya untung bersih akurat.</Empty>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {r.topExpenses.slice(0, 5).map((e) => (
            <li key={e.category} className="flex flex-col gap-1">
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-default-primary">{e.label}</span>
                <span className="whitespace-nowrap tabular-nums text-default-secondary">{rupiah(e.total)}</span>
              </div>
              <ProgressBar value={barPercent(e.total, max)} max={100} aria-label={`${e.label} ${rupiah(e.total)}`} />
            </li>
          ))}
        </ul>
      )}
      {r.topExpenses.length > 0 && <Alert variant="info" size="small" className="mt-3">Bayar pemasok tidak masuk daftar ini.</Alert>}
    </Card>
  )
}
