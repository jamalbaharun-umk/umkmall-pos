import {
  Alert,
  Button,
  Dialog,
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
import { Pencil, Search, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useConfirm } from '@/components/confirm'
import { useCan } from '@/components/shell'
import { Empty, Page, PageError, PageLoading, Panel } from '@/components/page'
import { deleteCategory, listCategories, saveCategory, type Category } from './-api'

export const Route = createFileRoute('/catalog/categories')({
  loader: () => listCategories(),
  pendingComponent: PageLoading,
  errorComponent: PageError,
  component: CategoriesPage,
})

/** Lakasir's category list: search, name column, Ubah/Hapus per row; create and edit take one field, in a modal. */
function CategoriesPage() {
  const categories = Route.useLoaderData()
  const router = useRouter()
  const confirm = useConfirm()
  const canEdit = useCan('catalog.manage')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const shown = categories.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))

  const remove = (c: Category) =>
    confirm.ask(`Hapus kategori ${c.name}?`, async () => {
      const r = await deleteCategory({ data: c.id })
      if (r.error) return r.error
      toast('Kategori dihapus', { variant: 'success' })
      await router.invalidate()
    })

  return (
    <Page
      title="Kategori"
      crumbs={[{ label: 'Kategori', to: '/catalog/categories' }, { label: 'Daftar' }]}
      actions={
        canEdit && (
          <Button type="primary" color="primary" size="small" width="auto" onClick={() => setEditing('new')}>
            Tambah kategori
          </Button>
        )
      }
    >
      <Panel>
        <div className="flex justify-end border-b border-border-light p-4">
          <div className="w-full sm:w-72">
            <TextField
              aria-label="Cari kategori"
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
            <Empty title="Kategori tidak ditemukan">Coba kata kunci lain.</Empty>
          ) : (
            <Empty
              title="Belum ada kategori"
              action={
                <Button type="primary" color="primary" size="small" width="auto" onClick={() => setEditing('new')}>
                  Tambah kategori
                </Button>
              }
            >
              Tambahkan kategori pertama, misalnya “Minuman” atau “Makanan”.
            </Empty>
          )
        ) : (
          <Table density="comfortable" containerClassName="border-0" className="whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <Button type="text" color="primary" size="small" width="auto" onClick={() => setEditing(c)}>
                          <Pencil className="size-4" aria-hidden /> Ubah
                        </Button>
                        <Button type="text" color="danger" size="small" width="auto" onClick={() => remove(c)}>
                          <Trash2 className="size-4" aria-hidden /> Hapus
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {categories.length > 0 && (
          <p className="border-t border-border-light p-4 text-sm text-default-secondary">
            Menampilkan {shown.length} dari {categories.length} kategori
          </p>
        )}
      </Panel>
      <CategoryDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        editing={editing}
        onClose={() => setEditing(null)}
      />
      {confirm.dialog}
    </Page>
  )
}

function CategoryDialog({ editing, onClose }: { editing: Category | 'new' | null; onClose: () => void }) {
  const router = useRouter()
  const existing = editing && editing !== 'new' ? editing : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(e: FormEvent, again = false) {
    e.preventDefault()
    if (!name.trim()) return setError('Nama wajib diisi.')
    setBusy(true)
    setError(undefined)
    const r = await saveCategory({ data: { id: existing?.id, name: name.trim() } }).catch(() => ({
      error: 'Terjadi kesalahan. Coba lagi sebentar lagi.',
    }))
    setBusy(false)
    if (r.error) return setError(r.error)
    toast(existing ? 'Kategori tersimpan' : 'Kategori dibuat', { variant: 'success' })
    await router.invalidate()
    if (again) setName('')
    else onClose()
  }

  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(open) => !open && !busy && onClose()}
      title={existing ? 'Ubah kategori' : 'Tambah kategori'}
      size="small"
      centered
      showCloseButton
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <TextField
          label="Nama"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Contoh: Minuman"
          maxLength={120}
          autoFocus
          required
        />
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="outline" color="light" size="small" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          {!existing && (
            <Button
              type="outline"
              color="primary"
              size="small"
              width="auto"
              disabled={busy}
              onClick={(e) => void submit(e as unknown as FormEvent, true)}
            >
              Simpan & buat lagi
            </Button>
          )}
          <Button htmlType="submit" type="primary" color="primary" size="small" width="auto" isLoading={busy}>
            Simpan
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
