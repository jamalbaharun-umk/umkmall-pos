import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Card } from '@umkmall/ui/compositions'
import { Alert, Button, Select } from '@umkmall/ui/primitives'
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
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({})
  const options = ZONES.some((z) => z.value === current) ? ZONES : [{ value: current, label: current }, ...ZONES]
  return (
    <Card variant="outlined" padding="medium" className="mt-6">
      <h2 className="font-semibold text-default-primary">Zona waktu toko</h2>
      <p className="mb-3 text-sm text-default-secondary">Menentukan awal dan akhir hari di semua laporan dan dasbor.</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setState({ busy: true })
          const r = await saveTimezone({ data: tz })
          setState(r.ok ? { saved: true } : { error: r.error })
          if (r.ok) await router.invalidate()
        }}
      >
        <Select label="Zona waktu" value={tz} onValueChange={setTz} options={options} />
        <Button htmlType="submit" type="primary" color="primary" width="auto" isLoading={state.busy}>Simpan</Button>
      </form>
      {state.error && <Alert variant="danger" className="mt-3">{state.error}</Alert>}
      {state.saved && <Alert variant="success" className="mt-3">Zona waktu disimpan.</Alert>}
    </Card>
  )
}
