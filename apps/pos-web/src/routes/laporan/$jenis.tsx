import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import { Alert, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField } from '@umkmall/ui/primitives'
import { loadReport, rupiah, type Report } from './-api'
import { REPORTS, type Column, type ReportDef } from './-reports'
import { ReportError, ReportLayout, ReportPending } from './-ui'

type Search = { from?: string; to?: string }

export const Route = createFileRoute('/laporan/$jenis')({
  validateSearch: (s): Search => ({
    ...(typeof s.from === 'string' ? { from: s.from } : {}),
    ...(typeof s.to === 'string' ? { to: s.to } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    if (!Object.hasOwn(REPORTS, params.jenis)) throw notFound()
    return loadReport({ data: { kind: REPORTS[params.jenis].kind, ...deps } })
  },
  component: ReportPage,
  pendingComponent: ReportPending,
  errorComponent: () => <ReportError />,
})

const cell = (c: Column, v: string | number | null | undefined) =>
  v == null ? '–' : c.money ? rupiah(Number(v)) : String(v)

const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  #laporan-cetak, #laporan-cetak * { visibility: visible; }
  #laporan-cetak { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0; box-shadow: none; }
}`

const dateLabel = (d: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))

function ReportPage() {
  const result = Route.useLoaderData()
  const def = REPORTS[Route.useParams().jenis]
  if (!result.ok) return <ReportError message={result.error} />
  return (
    <ReportLayout title={def.title}>
      <RangeForm jenis={Route.useParams().jenis} report={result.data} />
      <Printable def={def} report={result.data} />
    </ReportLayout>
  )
}

function RangeForm({ jenis, report }: { jenis: string; report: Report }) {
  const navigate = useNavigate()
  const [from, setFrom] = useState(report.from)
  const [to, setTo] = useState(report.to)
  const csv = `/laporan/csv/${jenis}?${new URLSearchParams({ from: report.from, to: report.to })}`
  return (
    <Card variant="outlined" padding="medium" className="mb-4 print:hidden">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void navigate({ to: '/laporan/$jenis', params: { jenis }, search: { from, to } })
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Dari tanggal" type="date" value={from} required onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Sampai tanggal" type="date" value={to} required onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button htmlType="submit" type="primary" color="primary" width="auto">Tampilkan</Button>
          <Button htmlType="button" type="outline" color="primary" width="auto" onClick={() => window.print()}>Cetak</Button>
          <Button asChild type="outline" color="primary" width="auto">
            <a href={csv} download>Unduh CSV</a>
          </Button>
        </div>
      </form>
    </Card>
  )
}

function Printable({ def, report }: { def: ReportDef; report: Report }) {
  return (
    <Card id="laporan-cetak" variant="outlined" padding="medium">
      {/* Cetak prints only this card, not the app shell around it (Lakasir swapped body.innerHTML instead). */}
      <style>{PRINT_CSS}</style>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-default-primary">{def.title}</h2>
        <p className="text-sm text-default-secondary">
          {dateLabel(report.from)} – {dateLabel(report.to)} · zona waktu {report.timezone}
        </p>
        <p className="text-sm text-default-secondary print:hidden">{def.hint}</p>
      </header>
      {report.truncated && (
        <Alert variant="warning" className="mb-4">
          Hanya 5.000 baris pertama yang ditampilkan; total di bawah tetap mencakup seluruh rentang. Unduh CSV atau persempit tanggal.
        </Alert>
      )}
      {report.rows.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-medium text-default-primary">Belum ada data pada rentang ini</p>
          <p className="text-sm text-default-secondary">Pilih tanggal lain lalu tekan Tampilkan.</p>
        </div>
      ) : (
        <Table density="compact">
          <TableHeader>
            <TableRow>
              {def.columns.map((c) => (
                <TableHead key={c.key} className={c.money || c.num ? 'whitespace-nowrap text-right' : 'whitespace-nowrap'}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((r, i) => (
              <TableRow key={i}>
                {def.columns.map((c) => (
                  <TableCell key={c.key} className={c.money || c.num ? 'whitespace-nowrap text-right tabular-nums' : 'whitespace-nowrap'}>{cell(c, r[c.key])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-1 border-t border-default-secondary pt-4 sm:grid-cols-2">
        {def.totals.map((t) => (
          <div key={t.key} className="flex justify-between gap-4">
            <dt className="text-default-secondary">{t.label}</dt>
            <dd className="font-medium tabular-nums text-default-primary">{t.money ? rupiah(report.totals[t.key] ?? 0) : (report.totals[t.key] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
