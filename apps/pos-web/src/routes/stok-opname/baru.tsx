import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { createOpname, loadOpnameForm } from '../pembelian/-api'
import { Button, Card, Empty, ErrorText, Field, inputClass, LoadError, Pending, StockLayout } from '../pembelian/-ui'

export const Route = createFileRoute('/stok-opname/baru')({
  loader: () => loadOpnameForm(),
  component: NewOpnamePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

type Line = { productId: string; countedQty: string; reason: string }
const blank = (): Line => ({ productId: '', countedQty: '', reason: '' })

function NewOpnamePage() {
  const products = Route.useLoaderData()
  const navigate = useNavigate()
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  if (products.length === 0)
    return (
      <StockLayout title="Hitung stok">
        <Card>
          <Empty title="Belum ada produk berstok" hint="Tambahkan produk berjenis Barang di katalog dulu." />
          <p className="text-center">
            <Link to="/catalog/products" className="text-brand hover:underline">
              Buka katalog
            </Link>
          </p>
        </Card>
      </StockLayout>
    )

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = lines.map((l) => ({
      productId: l.productId,
      countedQty: /^\d+$/.test(l.countedQty.trim()) ? Number(l.countedQty.trim()) : NaN,
      reason: l.reason.trim() || null,
    }))
    if (parsed.some((l) => !l.productId || Number.isNaN(l.countedQty)))
      return setError('Lengkapi produk dan jumlah hitungan (bilangan bulat, boleh 0).')
    if (new Set(parsed.map((l) => l.productId)).size !== parsed.length) return setError('Satu produk cukup satu baris.')
    setBusy(true)
    const r = await createOpname({ data: { note: note.trim() || null, lines: parsed } })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    await navigate({ to: '/stok-opname/$id', params: { id: r.id! } })
  }

  return (
    <StockLayout title="Hitung stok">
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-ink-muted">
            Stok sistem dicatat saat kamu menyimpan. Selisihnya baru diterapkan setelah opname disetujui.
          </p>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium text-ink">Hasil hitung</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-ink/10 p-3 sm:grid-cols-[1fr_6rem_10rem_auto]">
                <select aria-label="Produk" className={`${inputClass} col-span-2 sm:col-span-1`} value={l.productId} onChange={(e) => set(i, { productId: e.target.value })}>
                  <option value="">Pilih produk</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
                <input aria-label="Jumlah dihitung" placeholder="Jumlah" className={inputClass} inputMode="numeric" value={l.countedQty} onChange={(e) => set(i, { countedQty: e.target.value })} />
                <input aria-label="Alasan" placeholder="Alasan (rusak, hilang…)" className={inputClass} value={l.reason} onChange={(e) => set(i, { reason: e.target.value })} maxLength={200} />
                <Button variant="ghost" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris">
                  ✕
                </Button>
              </div>
            ))}
            <Button variant="ghost" onClick={() => setLines((ls) => [...ls, blank()])}>
              + Tambah produk
            </Button>
          </fieldset>
          <Field label="Catatan">
            <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan sebagai draf'}
          </Button>
        </form>
      </Card>
    </StockLayout>
  )
}
