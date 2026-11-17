import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  Button,
  Card,
  Dialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '@umkmall/ui'
import { useState, type FormEvent } from 'react'
import { Empty, ErrorText, LoadError, Page, Pending, useConfirm } from '@/components/pos-page'
import { deleteSupplier, loadSuppliers, saveSupplier, type Supplier } from '../pembelian/-api'

// Lakasir's Suppliers resource: a table (name, phone, address) with edit/delete row actions and a modal form.
export const Route = createFileRoute('/pemasok/')({
  loader: () => loadSuppliers(),
  component: SuppliersPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function SuppliersPage() {
  const suppliers = Route.useLoaderData()
  const router = useRouter()
  const { confirm, dialog } = useConfirm()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string>()
  const s = q.trim().toLowerCase()
  const shown = s
    ? suppliers.filter((x) => [x.name, x.phone, x.address].some((v) => v?.toLowerCase().includes(s)))
    : suppliers

  async function remove(sup: Supplier) {
    if (
      !(await confirm(`Hapus ${sup.name}?`, 'Pembelian lamanya tetap tersimpan.', { confirm: 'Hapus', danger: true }))
    )
      return
    const r = await deleteSupplier({ data: sup.id })
    if (!r.ok) return setError(r.error)
    setError(undefined)
    await router.invalidate()
  }

  return (
    <Page
      crumbs={[{ label: 'Pemasok', to: '/pemasok' }, { label: 'Daftar' }]}
      title="Pemasok"
      actions={
        <Button width="auto" onClick={() => setEditing('new')}>
          Pemasok baru
        </Button>
      }
    >
      <ErrorText>{error}</ErrorText>
      <Card variant="outlined" padding="none">
        <div className="flex justify-end p-4">
          <div className="w-full sm:w-72">
            <TextField
              aria-label="Cari pemasok"
              type="search"
              size="small"
              placeholder="Cari nama, telepon, alamat…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty
            title={suppliers.length === 0 ? 'Belum ada pemasok' : 'Pemasok tidak ditemukan'}
            hint={suppliers.length === 0 ? 'Tambahkan pemasok tempat kamu membeli barang.' : 'Coba kata lain.'}
          />
        ) : (
          <Table density="comfortable">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Telepon</TableHead>
                <TableHead>Alamat</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((sup) => (
                <TableRow key={sup.id}>
                  <TableCell className="font-medium">{sup.name}</TableCell>
                  <TableCell>{sup.phone ?? '–'}</TableCell>
                  <TableCell className="max-w-xs truncate">{sup.address ?? '–'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button width="auto" size="small" type="text" onClick={() => setEditing(sup)}>
                      Ubah
                    </Button>
                    <Button width="auto" size="small" type="text" color="danger" onClick={() => void remove(sup)}>
                      Hapus
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        centered
        size="medium"
        title={editing === 'new' ? 'Pemasok baru' : 'Ubah pemasok'}
      >
        {editing !== null && (
          <SupplierForm
            supplier={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={async () => {
              setEditing(null)
              await router.invalidate()
            }}
          />
        )}
      </Dialog>
      {dialog}
    </Page>
  )
}

function SupplierForm({
  supplier,
  onDone,
  onCancel,
}: {
  supplier: Supplier | null
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [address, setAddress] = useState(supplier?.address ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await saveSupplier({
      data: {
        id: supplier?.id,
        name,
        phone: phone.trim() || null,
        address: address.trim() || null,
      },
    }).catch(() => ({
      ok: false as const,
      error: 'Gagal menyimpan, coba lagi.',
    }))
    setBusy(false)
    if (!r.ok) return setError(r.error)
    await onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-6 pb-6">
      <TextField
        label="Nama"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
        autoFocus
      />
      <TextField
        label="Nomor telepon"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        inputMode="tel"
        maxLength={30}
      />
      <TextField
        label="Alamat"
        multiline
        rows={2}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        maxLength={500}
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button width="auto" htmlType="submit" isLoading={busy}>
          Simpan
        </Button>
        <Button width="auto" type="outline" color="light" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  )
}
