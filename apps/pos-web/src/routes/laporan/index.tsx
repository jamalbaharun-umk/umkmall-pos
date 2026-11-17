import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import { Button, Select, toast } from '@umkmall/ui/primitives'
import { loadSettings, saveTimezone } from './-api'
import { REPORTS } from './-reports'
import { ReportError, ReportLayout, ReportPending } from './-ui'

// Indonesia's three zones first; any other IANA zone can still be set through the API.
const ZONES = [
  { value: 'Asia/Jakarta', label: 'WIB (Asia/Jakarta)' },
  { value: 'Asia/Makassar', label: 'WITA (Asia/Makassar)' },
  { value: 'Asia/Jayapura', label: 'WIT (Asia/Jayapura)' },
]

export const Route = createFileRoute('/laporan/')({
  loader: () => loadSettings(),
  component: ReportIndex,
  pendingComponent: ReportPending,
  errorComponent: () => <ReportError />,
})

function ReportIndex() {
  const settings = Route.useLoaderData()
  if (!settings.ok) return <ReportError message={settings.error} />
  return (
    <ReportLayout title="Laporan">
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(REPORTS).map(([jenis, r]) => (
          <Link key={jenis} to="/laporan/$jenis" params={{ jenis }} className="block">
            <Card variant="outlined" padding="medium" className="h-full hover:border-default-brand">
              <h2 className="font-semibold text-default-primary">{r.title}</h2>
              <p className="mt-1 text-sm text-default-secondary">{r.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
      <TimezoneSetting current={settings.data.timezone} />
    </ReportLayout>
  )
}

function TimezoneSetting({ current }: { current: string }) {
  const router = useRouter()
  const [tz, setTz] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const options = ZONES.some((z) => z.value === current) ? ZONES : [{ value: current, label: current }, ...ZONES]
  return (
    <Card variant="outlined" padding="medium" className="mt-6">
      <h2 className="font-semibold text-default-primary">Zona waktu toko</h2>
      <p className="mb-3 text-sm text-default-secondary">Menentukan awal dan akhir hari di semua laporan dan dasbor.</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!tz) return setError('Zona waktu wajib diisi')
          setBusy(true)
          const r = await saveTimezone({ data: tz }).finally(() => setBusy(false))
          if (r.ok) {
            setError(undefined)
            toast('Zona waktu disimpan.', { variant: 'success' })
            await router.invalidate()
          } else {
            setError(r.errors?.timezone)
            toast(r.error, { variant: 'danger' })
          }
        }}
      >
        <Select label="Zona waktu" value={tz} onValueChange={setTz} options={options} error={error} />
        <Button htmlType="submit" type="primary" color="primary" width="auto" isLoading={busy}>Simpan</Button>
      </form>
    </Card>
  )
}
