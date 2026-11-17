import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { deleteSupplier, loadSuppliers, saveSupplier, type Supplier } from '../pembelian/-api'
import { Button, Card, Empty, ErrorText, Field, inputClass, LoadError, Pending, StockLayout } from '../pembelian/-ui'

export const Route = createFileRoute('/pemasok/')({
  loader: () => loadSuppliers(),
  component: SuppliersPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function SuppliersPage() {
  const suppliers = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [error, setError] = useState<string>()

  async function remove(s: Supplier) {
    if (!confirm(`Hapus pemasok ${s.name}? Pembelian lamanya tetap tersimpan.`)) return
    const r = await deleteSupplier({ data: s.id })
    if (!r.ok) return setError(r.error)
    if (editing?.id === s.id) setEditing(null)
    await router.invalidate()
  }

  return (
    <StockLayout title="Pemasok">
      <Card>
        <ErrorText>{error}</ErrorText>
        {suppliers.length === 0 ? (
          <Empty title="Belum ada pemasok" hint="Tambahkan pemasok tempat kamu membeli barang." />
        ) : (
          <ul className="divide-y divide-ink/10">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-sm text-ink-muted">
                    {[s.phone, s.address].filter(Boolean).join(' · ') || 'Tanpa kontak'}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => setEditing(s)}>
                    Ubah
                  </Button>
                  <Button variant="danger" onClick={() => void remove(s)}>
                    Hapus
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-medium text-ink">{editing ? `Ubah ${editing.name}` : 'Tambah pemasok'}</h2>
        <SupplierForm
          key={editing?.id ?? 'new'}
          supplier={editing}
          onDone={async () => {
            setEditing(null)
            await router.invalidate()
          }}
          onCancel={editing ? () => setEditing(null) : undefined}
        />
      </Card>
    </StockLayout>
  )
}

function SupplierForm({
  supplier,
  onDone,
  onCancel,
}: {
  supplier: Supplier | null
  onDone: () => Promise<void>
  onCancel?: () => void
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
      data: { id: supplier?.id, name, phone: phone.trim() || null, address: address.trim() || null },
    })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (!supplier) {
      setName('')
      setPhone('')
      setAddress('')
    }
    setError(undefined)
    await onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nama">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      </Field>
      <Field label="Telepon">
        <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} />
      </Field>
      <Field label="Alamat">
        <textarea className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={500} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Batal
          </Button>
        )}
      </div>
    </form>
  )
}
