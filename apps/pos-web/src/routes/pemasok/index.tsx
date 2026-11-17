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
import { useState, type FormEvent, useRef } from 'react'
import {
  act,
  check,
  compact,
  Empty,
  ErrorText,
  type FieldErrors,
  LoadError,
  Page,
  Pending,
  useConfirm,
} from '@/components/pos-page'
import { useCan } from '@/components/shell'
import { deleteSupplier, loadSuppliers, saveSupplier, type Supplier } from '../pembelian/-api'

// Lakasir's Suppliers resource: a table (name, phone, address) with edit/delete row actions and a modal form.
export const Route = createFileRoute('/pemasok/')({
  loader: () => loadSuppliers(),
  component: SuppliersPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function SuppliersPage() {
  const canManage = useCan('purchasing.manage')
  const suppliers = Route.useLoaderData()
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const shown = s
    ? suppliers.filter((x) => [x.name, x.phone, x.address].some((v) => v?.toLowerCase().includes(s)))
    : suppliers

  // The confirm dialog holds its button busy while this runs: no double delete.
  const remove = (sup: Supplier) =>
    ask(
      `Hapus ${sup.name}?`,
      async () => {
        const r = await act(() => deleteSupplier({ data: sup.id }), `${sup.name} dihapus`)
        if (!r.ok) return r.error
        await router.invalidate()
      },
      { body: 'Pembelian lamanya tetap tersimpan.' },
    )

  return (
    <Page
      crumbs={[{ label: 'Pemasok', to: '/pemasok' }, { label: 'Daftar' }]}
      title="Pemasok"
      actions={
        canManage && (
          <Button width="auto" onClick={() => setEditing('new')}>
            Pemasok baru
          </Button>
        )
      }
    >
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
                    {canManage && (
                      <>
                        <Button width="auto" size="small" type="text" onClick={() => setEditing(sup)}>
                          Ubah
                        </Button>
                        <Button width="auto" size="small" type="text" color="danger" onClick={() => remove(sup)}>
                          Hapus
                        </Button>
                      </>
                    )}
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

// Mirrors pos-api's SupplierInput: name 1–120, phone ≤ 30, address ≤ 500.
const validateSupplier = (v: { name: string; phone: string; address: string }) =>
  compact({
    name: check.required(v.name) ?? (v.name.trim().length > 120 ? 'Maksimal 120 karakter' : undefined),
    phone: check.phone(v.phone),
    address: v.address.trim().length > 500 ? 'Maksimal 500 karakter' : undefined,
  })

function SupplierForm({
  supplier,
  onDone,
  onCancel,
}: {
  supplier: Supplier | null
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [v, setV] = useState({
    name: supplier?.name ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // state lags a burst of clicks; the ref does not
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const local = validateSupplier(v)
    setErrors(local)
    if (Object.keys(local).length) return setError('Periksa kembali isian yang ditandai.')
    lock.current = true
    setBusy(true)
    const r = await act(
      () =>
        saveSupplier({
          data: {
            id: supplier?.id,
            name: v.name.trim(),
            phone: v.phone.trim() || null,
            address: v.address.trim() || null,
          },
        }),
      supplier ? 'Pemasok diperbarui' : 'Pemasok ditambahkan',
    )
    lock.current = false
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors)
      return setError(r.error)
    }
    await onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 px-6 pb-6">
      <TextField
        label="Nama"
        required
        value={v.name}
        onChange={set('name')}
        error={errors.name}
        maxLength={120}
        autoFocus
      />
      <TextField
        label="Nomor telepon"
        value={v.phone}
        onChange={set('phone')}
        error={errors.phone}
        inputMode="tel"
        maxLength={30}
      />
      <TextField
        label="Alamat"
        multiline
        rows={2}
        value={v.address}
        onChange={set('address')}
        error={errors.address}
        maxLength={500}
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button width="auto" htmlType="submit" isLoading={busy}>
          Simpan
        </Button>
        <Button width="auto" type="outline" color="light" disabled={busy} onClick={onCancel}>
          Batal
        </Button>
      </div>
    </form>
  )
}
