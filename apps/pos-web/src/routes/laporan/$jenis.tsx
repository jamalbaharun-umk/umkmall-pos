import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import { Alert, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField, toast } from '@umkmall/ui/primitives'
import { loadReport, rupiah, type FieldErrors, type Report } from './-api'
import { cashDiff, checkRange, REPORTS, type Column, type ReportDef } from './-reports'
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
  v == null ? '–' : c.cashDiff ? cashDiff(Number(v)) : c.money ? rupiah(Number(v)) : String(v)

const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  #laporan-cetak, #laporan-cetak * { visibility: visible; }
  #laporan-cetak { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0; box-shadow: none; }
}`

const dateLabel = (d: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))

function ReportPage() {
  const result = Route.useLoaderData()
  const search = Route.useSearch()
  const jenis = Route.useParams().jenis
  const def = REPORTS[jenis]
  // A refused range keeps the form, with pos-api's message on the field it names.
  if (!result.ok && result.status !== 422) return <ReportError message={result.error} />
  return (
    <ReportLayout title={def.title}>
      {result.ok ? (
        <>
          <RangeForm key={`${result.data.from}_${result.data.to}`} jenis={jenis} from={result.data.from} to={result.data.to} />
          <Printable def={def} report={result.data} />
        </>
      ) : (
        <RangeForm jenis={jenis} from={search.from ?? ''} to={search.to ?? ''} serverErrors={result.errors ?? { _: result.error }} />
      )}
    </ReportLayout>
  )
}

/** Downloads the CSV through the session route; says how it went in a toast. */
async function downloadCsv(jenis: string, from: string, to: string) {
  const res = await fetch(`/laporan/csv/${jenis}?${new URLSearchParams({ from, to })}`).catch(() => null)
  if (!res?.ok) {
    // Only our route's JSON `{ message }` is shown; anything else (a proxy page, a framework error) gets the generic line.
    const body = res?.headers.get('content-type')?.includes('application/json')
      ? ((await res.json().catch(() => null)) as { message?: unknown } | null)
      : null
    const fromServer = res && [403, 422, 502].includes(res.status) && typeof body?.message === 'string' ? body.message : null
    toast(fromServer ?? 'Laporan belum bisa diunduh, coba lagi.', { variant: 'danger' })
    return
  }
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: `laporan-${jenis}-${from}_${to}.csv` })
  a.click()
  URL.revokeObjectURL(url)
  toast('Laporan CSV diunduh.', { variant: 'success' })
}

function RangeForm({ jenis, from: from0, to: to0, serverErrors }: { jenis: string; from: string; to: string; serverErrors?: FieldErrors }) {
  const navigate = useNavigate()
  const [from, setFrom] = useState(from0)
  const [to, setTo] = useState(to0)
  const [errors, setErrors] = useState<FieldErrors>(serverErrors ?? {})
  const [exporting, setExporting] = useState(false)
  // The busy state only applies on the next render; two clicks in one tick must still start one export.
  const exportRunning = useRef(false)
  // Each action checks the dates first, with the same messages pos-api would answer.
  const valid = () => {
    const e = checkRange(from, to)
    setErrors(e)
    return Object.keys(e).length === 0
  }
  return (
    <Card variant="outlined" padding="medium" className="mb-4 print:hidden">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (valid()) void navigate({ to: '/laporan/$jenis', params: { jenis }, search: { from, to } })
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Dari tanggal" type="date" value={from} required error={errors.from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Sampai tanggal" type="date" value={to} required error={errors.to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {errors._ && <Alert variant="danger" className="mt-3">{errors._}</Alert>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button htmlType="submit" type="primary" color="primary" width="auto">Tampilkan</Button>
          <Button htmlType="button" type="outline" color="primary" width="auto" disabled={!!serverErrors} onClick={() => window.print()}>Cetak</Button>
          <Button
            htmlType="button"
            type="outline"
            color="primary"
            width="auto"
            isLoading={exporting}
            onClick={async () => {
              if (exportRunning.current || !valid()) return
              exportRunning.current = true
              setExporting(true)
              await downloadCsv(jenis, from, to).finally(() => {
                exportRunning.current = false
                setExporting(false)
              })
            }}
          >
            Unduh CSV
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
