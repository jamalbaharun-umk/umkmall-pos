import {
  Alert,
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
  toast,
} from '@umkmall/ui/primitives'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useConfirm } from '@/components/confirm'
import { Empty, Page, PageError, PageLoading, Panel, dateTime } from '@/components/page'
import { bindThisDevice, loadDevicesPage, revokeDevice, revokeSession, type Result } from './-api'

export const Route = createFileRoute('/staf/perangkat')({
  loader: () => loadDevicesPage(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: DevicesPage,
})

/** POS-only (U4, no Lakasir counterpart): bind this browser as a cashier device, revoke devices and live sessions. */
function DevicesPage() {
  const { devices, sessions, thisDeviceId } = Route.useLoaderData()
  const router = useRouter()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const thisBound = devices.some((d) => d.id === thisDeviceId && !d.revokedAt)

  async function bind(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Beri nama perangkat ini, misalnya "Kasir depan".')
    setBusy(true)
    setError(undefined)
    const res = await bindThisDevice({ data: name.trim() }).catch((): Result => ({ ok: false, error: 'Gagal, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setName('')
    toast('Perangkat terhubung', { variant: 'success' })
    await router.invalidate()
  }

  const ask = (title: string, body: string, label: string, run: () => Promise<Result>, done: string) =>
    confirm.ask(
      title,
      async () => {
        const r = await run()
        if (!r.ok) return r.error
        toast(done, { variant: 'success' })
        await router.invalidate()
      },
      { body, label },
    )

  return (
    <Page title="Perangkat kasir" crumbs={[{ label: 'Perangkat', to: '/staf/perangkat' }, { label: 'Daftar' }]}>
      <Panel className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="font-semibold text-default-primary">Hubungkan perangkat ini</h2>
          <p className="mt-1 text-sm text-default-secondary">
            Buka halaman ini di perangkat yang dipakai kasir, lalu hubungkan. Kasir hanya bisa masuk dengan PIN di
            perangkat yang terhubung.
          </p>
        </div>
        {thisBound ? (
          <Alert variant="success">
            Perangkat ini sudah terhubung. Kasir masuk di halaman{' '}
            <a className="font-semibold underline" href="/kasir/masuk">
              Masuk kasir
            </a>
            .
          </Alert>
        ) : (
          <form onSubmit={(e) => void bind(e)} className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="md:w-96">
              <TextField
                label="Nama perangkat"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Kasir depan"
                maxLength={60}
              />
            </div>
            <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
              Hubungkan
            </Button>
          </form>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
      </Panel>

      <Panel>
        <h2 className="border-b border-border-light p-4 font-semibold text-default-primary">Perangkat terhubung</h2>
        {devices.length === 0 ? (
          <Empty title="Belum ada perangkat">Hubungkan perangkat kasir pertama di atas.</Empty>
        ) : (
          <Table density="comfortable" containerClassName="border-0" className="whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Terhubung</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    {d.name}
                    {d.id === thisDeviceId && <span className="ml-2 text-default-brand">(perangkat ini)</span>}
                  </TableCell>
                  <TableCell>
                    <Badge color={d.revokedAt ? 'light' : 'success'} size="small">
                      {d.revokedAt ? `Dicabut ${dateTime(d.revokedAt)}` : 'Aktif'}
                    </Badge>
                  </TableCell>
                  <TableCell>{dateTime(d.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {!d.revokedAt && (
                      <Button
                        type="text"
                        color="danger"
                        size="small"
                        width="auto"
                        onClick={() =>
                          ask(
                            `Cabut ${d.name}?`,
                            'Kasir yang sedang masuk di perangkat ini akan keluar, dan perangkat harus dihubungkan lagi.',
                            'Cabut',
                            () => revokeDevice({ data: d.id }),
                            'Perangkat dicabut',
                          )
                        }
                      >
                        Cabut
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <h2 className="border-b border-border-light p-4 font-semibold text-default-primary">Kasir yang sedang masuk</h2>
        {sessions.length === 0 ? (
          <Empty title="Tidak ada sesi kasir">Sesi muncul di sini saat kasir masuk dengan PIN.</Empty>
        ) : (
          <Table density="comfortable" containerClassName="border-0" className="whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Kasir</TableHead>
                <TableHead>Perangkat</TableHead>
                <TableHead>Masuk</TableHead>
                <TableHead>Berakhir</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.staff.name}</TableCell>
                  <TableCell>{s.device.name}</TableCell>
                  <TableCell>{dateTime(s.createdAt)}</TableCell>
                  <TableCell>{dateTime(s.expiresAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="text"
                      color="danger"
                      size="small"
                      width="auto"
                      onClick={() =>
                        ask(
                          `Keluarkan ${s.staff.name}?`,
                          'Kasir harus masuk lagi dengan PIN.',
                          'Keluarkan',
                          () => revokeSession({ data: s.id }),
                          'Sesi kasir diakhiri',
                        )
                      }
                    >
                      Keluarkan
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {confirm.dialog}
    </Page>
  )
}
