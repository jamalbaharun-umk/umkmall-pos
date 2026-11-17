import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { createOrder, loadOrderForm } from './-api'
import { Button, Card, Empty, ErrorText, Field, inputClass, LoadError, Pending, rupiah, StockLayout } from './-ui'

export const Route = createFileRoute('/pembelian/baru')({
  loader: () => loadOrderForm(),
  component: NewOrderPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

type Line = { productId: string; qty: string; unitCost: string }
const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

function NewOrderPage() {
  const { suppliers, products } = Route.useLoaderData()
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [paymentMethod, setPaymentMethod] = useState('Tunai')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([{ productId: '', qty: '1', unitCost: '' }])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  if (suppliers.length === 0 || products.length === 0)
    return (
      <StockLayout title="Buat pembelian">
        <Card>
          <Empty
            title={suppliers.length === 0 ? 'Belum ada pemasok' : 'Belum ada produk berstok'}
            hint={suppliers.length === 0 ? 'Tambahkan pemasok dulu.' : 'Tambahkan produk berjenis Barang di katalog dulu.'}
          />
          <p className="text-center">
            <Link to={suppliers.length === 0 ? '/pemasok' : '/catalog/products'} className="text-brand hover:underline">
              {suppliers.length === 0 ? 'Buka pemasok' : 'Buka katalog'}
            </Link>
          </p>
        </Card>
      </StockLayout>
    )

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  // Preview only: pos-api computes the stored total.
  const total = lines.reduce((sum, l) => sum + (toInt(l.qty) * toInt(l.unitCost) || 0), 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = lines.map((l) => ({ productId: l.productId, qty: toInt(l.qty), unitCost: toInt(l.unitCost) }))
    if (parsed.some((l) => !l.productId || !(l.qty > 0) || !(l.unitCost >= 0)))
      return setError('Lengkapi produk, jumlah (bilangan bulat > 0) dan harga beli (rupiah tanpa desimal).')
    if (new Set(parsed.map((l) => l.productId)).size !== parsed.length)
      return setError('Satu produk cukup satu baris.')
    setBusy(true)
    const r = await createOrder({
      data: { supplierId, paymentMethod: paymentMethod.trim() || null, note: note.trim() || null, lines: parsed },
    })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    await navigate({ to: '/pembelian/$id', params: { id: r.id! } })
  }

  return (
    <StockLayout title="Buat pembelian">
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Pemasok">
            <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Metode pembayaran">
            <input className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} maxLength={60} placeholder="Tunai, Transfer, Tempo…" />
          </Field>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium text-ink">Barang</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-ink/10 p-3 sm:grid-cols-[1fr_6rem_8rem_auto]">
                <select
                  aria-label="Produk"
                  className={`${inputClass} col-span-2 sm:col-span-1`}
                  value={l.productId}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value)
                    set(i, { productId: e.target.value, unitCost: l.unitCost || String(p?.costPrice ?? '') })
                  }}
                >
                  <option value="">Pilih produk</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
                <input aria-label="Jumlah" className={inputClass} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                <input aria-label="Harga beli per satuan (Rp)" placeholder="Harga beli" className={inputClass} inputMode="numeric" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
                <Button variant="ghost" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris">
                  ✕
                </Button>
              </div>
            ))}
            <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { productId: '', qty: '1', unitCost: '' }])}>
              + Tambah barang
            </Button>
          </fieldset>
          <Field label="Catatan">
            <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <p className="text-lg font-semibold text-ink">Total {rupiah(total)}</p>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan sebagai draf'}
          </Button>
        </form>
      </Card>
    </StockLayout>
  )
}
