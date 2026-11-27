import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField } from '@umkmall/ui/primitives'
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { notifySuccess } from '@/lib/feedback'
import { useConfirm } from '@/components/confirm'
import { Empty, Page, PageError, PageLoading, Panel, dateTime } from '@/components/page'
import { deleteStaff, loadStaffPage } from './-api'
import { StaffSummary } from '../ringkasan/-panels'

export const Route = createFileRoute('/staf/')({
  loader: () => loadStaffPage(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: StaffPage,
})

/** Lakasir's user list: search, name/roles/status columns, Ubah and Hapus per row. */
function StaffPage() {
  const { staff } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const shown = staff.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))

  const remove = (id: string, name: string) =>
    confirm.ask(
      `Hapus ${name}?`,
      async () => {
        const r = await deleteStaff({ data: id })
        if (!r.ok) return r
        notifySuccess('Staf dihapus')
        await router.invalidate()
      },
      { body: 'Staf yang dihapus tidak bisa masuk lagi dan sesi kasirnya berakhir.', action: 'menghapus staf' },
    )

  return (
    <Page
      title="Staf"
      crumbs={[{ label: 'Staf', to: '/staf' }, { label: 'Daftar' }]}
      actions={
        <Button asChild type="primary" color="primary" size="small" width="auto">
          <Link to="/staf/baru">Tambah staf</Link>
        </Button>
      }
    >
      <StaffSummary />
      <Panel>
        <div className="flex justify-end border-b border-border-light p-4">
          <div className="w-full md:w-72">
            <TextField
              aria-label="Cari staf"
              size="xsmall"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari"
              leadingAdornment={<Search className="size-4 text-default-secondary" aria-hidden />}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          q ? (
            <Empty title="Staf tidak ditemukan">Coba kata kunci lain.</Empty>
          ) : (
            <Empty
              title="Belum ada staf"
              action={
                <Button asChild type="primary" color="primary" size="small" width="auto">
                  <Link to="/staf/baru">Tambah staf</Link>
                </Button>
              }
            >
              Tambahkan kasir pertama. Kasir masuk dengan PIN di perangkat yang terhubung.
            </Empty>
          )
        ) : (
          <Table density="comfortable" containerClassName="border-0" className="whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.roles.map((r) => r.name).join(', ') || 'Tanpa peran'}</TableCell>
                  <TableCell>
                    <Badge color={s.active ? 'success' : 'light'} size="small">
                      {s.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell>{dateTime(s.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="text"
                        color="primary"
                        size="small"
                        width="auto"
                        onClick={() => void navigate({ to: '/staf/$id', params: { id: s.id } })}
                      >
                        <Pencil className="size-4" aria-hidden /> Ubah
                      </Button>
                      <Button type="text" color="danger" size="small" width="auto" onClick={() => remove(s.id, s.name)}>
                        <Trash2 className="size-4" aria-hidden /> Hapus
                      </Button>
                    </div>
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
