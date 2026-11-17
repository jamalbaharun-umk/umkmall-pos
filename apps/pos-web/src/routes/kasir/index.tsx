import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Button, Card, Empty, ErrorText, Field, inputClass, LoadError, Pending } from '../staf/-ui'
import { createSale, loadCashier, openShift, type Product, rupiah } from './-api'
import { parseRupiah, quickAmounts, taxOf } from './-money'
import { KasirMain } from './-ui'

// The classic Lakasir cashier (not PosV2): product grid → cart → cash with quick amounts → change → receipt.
export const Route = createFileRoute('/kasir/')({
  loader: () => loadCashier(),
  component: CashierPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function CashierPage() {
  const { shift, products, taxBps } = Route.useLoaderData()
  return (
    <KasirMain title="Kasir">{shift ? <Register products={products} taxBps={taxBps} /> : <OpenShift />}</KasirMain>
  )
}

function OpenShift() {
  const router = useRouter()
  const [cash, setCash] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseRupiah(cash || '0')
    if (Number.isNaN(amount)) return setError('Isi uang awal dengan angka.')
    setBusy(true)
    setError(undefined)
    const res = await openShift({ data: amount }).catch(() => ({ ok: false as const, error: 'Gagal membuka shift, coba lagi.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    await router.invalidate()
  }
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h2 className="text-lg font-medium text-ink">Buka shift</h2>
        <p className="mt-1 text-sm text-ink-muted">Hitung uang di laci sebelum mulai berjualan.</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="Uang awal di laci (Rp)">
            <input className={inputClass} inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" autoFocus />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full py-3">{busy ? 'Membuka…' : 'Buka shift'}</Button>
        </form>
      </Card>
    </div>
  )
}

type CartLine = { product: Product; qty: number }

function Register({ products, taxBps }: { products: Product[]; taxBps: number }) {
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [paying, setPaying] = useState(false)
  // One key per cart: a double tap or a retry after a network error sends the same key, so one sale.
  const [key, setKey] = useState(() => crypto.randomUUID())

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? products.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)) : products
  }, [q, products])

  const subtotal = cart.reduce((n, l) => n + l.product.sellingPrice * l.qty, 0)
  const tax = taxOf(subtotal, taxBps)
  const total = subtotal + tax

  const add = (product: Product) =>
    setCart((c) =>
      c.some((l) => l.product.id === product.id)
        ? c.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { product, qty: 1 }],
    )
  const setQty = (id: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))))

  if (products.length === 0)
    return (
      <Card>
        <Empty title="Belum ada produk aktif" hint="Tambahkan produk di Katalog untuk mulai berjualan." />
        <div className="text-center">
          <Link to="/catalog/products" className="text-brand hover:underline">Buka katalog</Link>
        </div>
      </Card>
    )

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <section aria-label="Produk">
        <input className={inputClass} type="search" placeholder="Cari nama atau SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length === 0 ? (
          <Empty title="Produk tidak ditemukan" hint="Coba kata lain." />
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => add(p)} className="flex h-full min-h-24 w-full flex-col justify-between rounded-xl bg-white p-3 text-left shadow-sm hover:ring-2 hover:ring-brand active:scale-[0.98]">
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="mt-2 text-sm text-brand">{rupiah(p.sellingPrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside aria-label="Keranjang" className="md:sticky md:top-4 md:self-start">
        <Card>
          <h2 className="text-lg font-medium text-ink">Keranjang</h2>
          {cart.length === 0 ? (
            <Empty title="Keranjang kosong" hint="Ketuk produk untuk menambahkannya." />
          ) : (
            <ul className="mt-3 divide-y divide-ink/10">
              {cart.map((l) => (
                <li key={l.product.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{l.product.name}</span>
                    <span className="text-sm text-ink-muted">{rupiah(l.product.sellingPrice * l.qty)}</span>
                  </span>
                  <button type="button" aria-label={`Kurangi ${l.product.name}`} onClick={() => setQty(l.product.id, l.qty - 1)} className="size-10 rounded-lg bg-brand-soft text-lg text-brand">−</button>
                  <span className="w-8 text-center tabular-nums">{l.qty}</span>
                  <button type="button" aria-label={`Tambah ${l.product.name}`} onClick={() => setQty(l.product.id, l.qty + 1)} className="size-10 rounded-lg bg-brand-soft text-lg text-brand">+</button>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-4 space-y-1 border-t border-ink/10 pt-3 text-sm">
            <Row label="Subtotal" value={rupiah(subtotal)} />
            {taxBps > 0 && <Row label={`Pajak ${taxBps / 100}%`} value={rupiah(tax)} />}
            <div className="flex justify-between pt-1 text-lg font-semibold text-ink">
              <dt>Total</dt>
              <dd>{rupiah(total)}</dd>
            </div>
          </dl>
          <Button className="mt-4 w-full py-3 text-lg" disabled={cart.length === 0} onClick={() => setPaying(true)}>Bayar</Button>
          {cart.length > 0 && (
            <button type="button" onClick={() => setCart([])} className="mt-2 w-full py-2 text-sm text-ink-muted hover:text-error">Kosongkan keranjang</button>
          )}
        </Card>
      </aside>

      {paying && (
        <PayDialog
          total={total}
          cart={cart}
          idempotencyKey={key}
          onClose={() => setPaying(false)}
          onPaid={() => {
            setCart([])
            setKey(crypto.randomUUID())
          }}
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-muted">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function PayDialog({ total, cart, idempotencyKey, onClose, onPaid }: {
  total: number
  cart: CartLine[]
  idempotencyKey: string
  onClose: () => void
  onPaid: () => void
}) {
  const navigate = useNavigate()
  const [paidText, setPaidText] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const paid = parseRupiah(paidText)
  const change = Number.isNaN(paid) ? null : paid - total

  async function pay(amount: number) {
    if (busy) return
    if (Number.isNaN(amount) || amount < total) return setError('Uang yang dibayar kurang dari total.')
    setBusy(true)
    setError(undefined)
    const res = await createSale({
      data: { key: idempotencyKey, lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty })), paid: amount },
    }).catch(() => ({ ok: false as const, error: 'Tidak bisa terhubung. Coba lagi: penjualan tidak akan tercatat dua kali.' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    onPaid()
    await navigate({ to: '/kasir/struk/$id', params: { id: res.data.id } })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Pembayaran tunai" className="fixed inset-0 z-10 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-ink">Bayar tunai</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Batal</button>
        </div>
        <p className="mt-2 text-3xl font-semibold text-ink">{rupiah(total)}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {quickAmounts(total).map((n) => (
            <button key={n} type="button" disabled={busy} onClick={() => setPaidText(String(n))} className={`rounded-lg px-3 py-3 font-medium ${paid === n ? 'bg-brand text-white' : 'bg-brand-soft text-brand'}`}>
              {n === total ? 'Uang pas' : rupiah(n)}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void pay(paid) }} className="mt-4 space-y-3">
          <Field label="Uang diterima (Rp)">
            <input className={inputClass} inputMode="numeric" value={paidText} onChange={(e) => setPaidText(e.target.value)} placeholder="0" autoFocus />
          </Field>
          <p className="flex justify-between text-lg">
            <span className="text-ink-muted">Kembalian</span>
            <span className={`font-semibold ${change !== null && change < 0 ? 'text-error' : 'text-success'}`}>
              {change === null ? '—' : change < 0 ? `Kurang ${rupiah(-change)}` : rupiah(change)}
            </span>
          </p>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy || change === null || change < 0} className="w-full py-3 text-lg">
            {busy ? 'Memproses…' : 'Selesaikan'}
          </Button>
        </form>
      </div>
    </div>
  )
}
