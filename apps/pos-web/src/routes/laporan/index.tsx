import { createFileRoute, Link } from '@tanstack/react-router'
import { Card } from '@umkmall/ui/compositions'
import { useCan } from '@/components/shell'
import { loadSettings } from './-api'
import { REPORTS } from './-reports'
import { ReportError, ReportLayout, ReportPending } from './-ui'

// Labels for Indonesia's three zones; any other IANA zone shows as its name.
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
        <Link to="/laporan/untung-rugi" search={{ period: 'today' }} className="block">
          <Card variant="outlined" padding="medium" className="h-full hover:border-default-brand">
            <h2 className="font-semibold text-default-primary">Untung rugi</h2>
            <p className="mt-1 text-sm text-default-secondary">Hasil jualan, modal barang, pengeluaran, dan untung bersih.</p>
          </Card>
        </Link>
      </div>
      <TimezoneSetting current={settings.data.timezone} />
    </ReportLayout>
  )
}

/** Read-only: the timezone is edited in one place, Pengaturan → Aplikasi (Lakasir's General Setting). */
function TimezoneSetting({ current }: { current: string }) {
  const canEdit = useCan('catalog.manage')
  const label = ZONES.find((z) => z.value === current)?.label ?? current
  return (
    <Card variant="outlined" padding="medium" className="mt-6">
      <h2 className="font-semibold text-default-primary">Zona waktu toko: {label}</h2>
      <p className="mt-1 text-sm text-default-secondary">
        Menentukan awal dan akhir hari di semua laporan dan dasbor.{' '}
        {canEdit ? (
          <>
            Ubah di{' '}
            <Link to="/pengaturan" className="font-medium text-default-brand underline">
              Pengaturan → Aplikasi
            </Link>
            .
          </>
        ) : (
          'Pemilik bisa mengubahnya di Pengaturan.'
        )}
      </p>
    </Card>
  )
}
