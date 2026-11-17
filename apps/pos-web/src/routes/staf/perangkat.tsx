import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { Result } from './-api'
import { bindThisDevice, loadDevicesPage, revokeDevice, revokeSession } from './-api'
import { Button, Card, Empty, ErrorText, Field, formatDate, inputClass, LoadError, Pending, StaffLayout } from './-ui'

export const Route = createFileRoute('/staf/perangkat')({
  loader: () => loadDevicesPage(),
  component: DevicesPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function DevicesPage() {
  const { devices, sessions, thisDeviceId } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const thisBound = devices.some((d) => d.id === thisDeviceId && !d.revokedAt)

  async function run(action: () => Promise<Result>) {
    setBusy(true)
    setError(undefined)
    const res = await action().catch((): Result => ({ ok: false, error: 'Gagal, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    await router.invalidate()
  }

  function bind(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Beri nama perangkat ini, misalnya "Kasir depan".')
    void run(() => bindThisDevice({ data: name.trim() })).then(() => setName(''))
  }

  return (
    <StaffLayout title="Perangkat kasir">
      <Card>
        <h2 className="text-lg font-medium text-ink">Hubungkan perangkat ini</h2>
        {thisBound ? (
          <p className="mt-1 text-sm text-success">
            Perangkat ini sudah terhubung. Kasir masuk di halaman <a className="underline" href="/kasir/masuk">Masuk kasir</a>.
          </p>
        ) : (
          <form onSubmit={bind} className="mt-3 space-y-3">
            <p className="text-sm text-ink-muted">
              Buka halaman ini di perangkat yang dipakai kasir, lalu hubungkan. Kasir hanya bisa masuk dengan PIN di
              perangkat yang terhubung.
            </p>
            <Field label="Nama perangkat">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
            <Button type="submit" disabled={busy}>
              Hubungkan
            </Button>
          </form>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-medium text-ink">Perangkat terhubung</h2>
        {devices.length === 0 ? (
          <Empty title="Belum ada perangkat" hint="Hubungkan perangkat kasir pertama di atas." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium text-ink">{d.name}</span>
                  {d.id === thisDeviceId && <span className="ml-2 text-sm text-brand">(perangkat ini)</span>}
                  <span className="block text-sm text-ink-muted">
                    {d.revokedAt ? `Dicabut ${formatDate(d.revokedAt)}` : `Terhubung ${formatDate(d.createdAt)}`}
                  </span>
                </span>
                {!d.revokedAt && (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      window.confirm(`Cabut ${d.name}? Kasir yang sedang masuk di perangkat ini akan keluar.`) &&
                      void run(() => revokeDevice({ data: d.id }))
                    }
                  >
                    Cabut
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-medium text-ink">Kasir yang sedang masuk</h2>
        {sessions.length === 0 ? (
          <Empty title="Tidak ada sesi kasir" hint="Sesi muncul di sini saat kasir masuk dengan PIN." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium text-ink">{s.staff.name}</span>
                  <span className="block text-sm text-ink-muted">
                    {s.device.name} · masuk {formatDate(s.createdAt)}
                  </span>
                </span>
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => revokeSession({ data: s.id }))}>
                  Keluarkan
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StaffLayout>
  )
}
