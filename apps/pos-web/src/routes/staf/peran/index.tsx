import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField } from '@umkmall/ui/primitives'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Pencil, Search } from 'lucide-react'
import { useState } from 'react'
import { Empty, Page, PageError, PageLoading, Panel } from '@/components/page'
import { loadRolesPage } from '../-api'

export const Route = createFileRoute('/staf/peran/')({
  loader: () => loadRolesPage(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: RolesPage,
})

/** Lakasir's role list: search, the name column, Ubah per row. */
function RolesPage() {
  const { roles, permissions } = Route.useLoaderData()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const shown = roles.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <Page
      title="Peran"
      crumbs={[{ label: 'Peran', to: '/staf/peran' }, { label: 'Daftar' }]}
      actions={
        <Button asChild type="primary" color="primary" size="small" width="auto">
          <Link to="/staf/peran/baru">Tambah peran</Link>
        </Button>
      }
    >
      <Panel>
        <div className="flex justify-end border-b border-border-light p-4">
          <div className="w-full md:w-72">
            <TextField
              aria-label="Cari peran"
              size="xsmall"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari"
              leadingAdornment={<Search className="size-4 text-default-secondary" aria-hidden />}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty title={q ? 'Peran tidak ditemukan' : 'Belum ada peran'}>
            {q ? 'Coba kata kunci lain.' : 'Buat peran lalu pilih izinnya.'}
          </Empty>
        ) : (
          <Table density="comfortable" containerClassName="border-0" className="whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Izin</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    {r.permissions.length === permissions.length ? 'Semua izin' : `${r.permissions.length} izin`}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        type="text"
                        color="primary"
                        size="small"
                        width="auto"
                        onClick={() => void navigate({ to: '/staf/peran/$id', params: { id: r.id } })}
                      >
                        <Pencil className="size-4" aria-hidden /> Ubah
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {roles.length > 0 && (
          <p className="border-t border-border-light p-4 text-sm text-default-secondary">
            Menampilkan {shown.length} dari {roles.length} peran
          </p>
        )}
      </Panel>
    </Page>
  )
}
