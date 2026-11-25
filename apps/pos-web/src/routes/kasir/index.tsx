import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  SegmentedControl,
  SelectionCard,
  Tabs,
  TabsList,
  TabsTrigger,
  Text,
  TextField,
} from '@umkmall/ui'
import { useEffect, useMemo, useState, useRef } from 'react'
import { notifySuccess, showError } from '@/lib/feedback'
import { act, Empty, ErrorText, LoadError, Pending, rupiah } from '@/components/pos-page'
import { useCan } from '@/components/shell'
import {
  createSale,
  loadCashier,
  openShift,
  quoteCart,
  type MemberOption,
  type PaymentMethod,
  type Product,
} from './-api'
import { MemberRow, VoucherRow, type AppliedVoucher } from './-u7'
import { readCart, restoreCart, writeCart } from './-cart'
import { overStock, stockOverMessage, stockState } from './-stock'
import {
  addEntry,
  baseQtyInCart,
  cartSignature,
  entryKey,
  needsUnitPicker,
  priceEntries,
  requestLines,
  savedLines,
  savingsNote,
  setEntryQty,
  stockLines,
  subtotalOf,
  unitLabel,
  unitOptions,
  wholesaleHints,
  type CartEntry,
  type Quote,
  canProceedToPayment,
} from './-helpers'
import {
  confirmButtonLabel,
  isStaticQris,
  offeredMethods,
  payStepOf,
  qrisScanHint,
  qrisSrc,
  QRIS_LOAD_ERROR,
  QRIS_NO_BANK_CHECK,
} from './-pay-step'
import { AwaitingList, OnlineWait, ResumeGate, useResumeOnlineSale, type OnlineFinish } from './-online-pay'
import { finishPlan, forgetPending, parsePayment, rememberPending, saleFailure, saleKey, type SalePayment } from './-online'
import { cashRounding, discountError, numpadEdit, parseRupiah, qtyError, quickAmounts, taxOf } from './-money'

// Lakasir's classic cashier (/member/cashier, not PosV2), full screen: product grid with search and category tabs on
// the left, "Orders details" on the right, then the payment modal (method, quick amounts, numpad, "Pay it") and the
// success modal (change, Print).
export const Route = createFileRoute('/kasir/')({
  loader: () => loadCashier(),
  component: CashierPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function CashierPage() {
  const { shift, products, taxBps, methods, qris, chargeable } = Route.useLoaderData()
  return shift ? (
    <Register products={products} taxBps={taxBps} methods={methods} qris={qris} chargeable={chargeable} />
  ) : (
    <OpenShift />
  )
}

function OpenShift() {
  const router = useRouter()
  const [cash, setCash] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // state lags a burst of clicks; the ref does not
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (lock.current) return
    if (!cash.trim()) return setError('Wajib diisi (isi 0 bila laci kosong)')
    const amount = parseRupiah(cash)
    if (Number.isNaN(amount)) return setError('Harus bilangan bulat rupiah, misalnya 100.000')
    lock.current = true
    setBusy(true)
    setError(undefined)
    const r = await act(() => openShift({ data: amount }), 'Shift dibuka. Selamat berjualan!', 'membuka shift')
    lock.current = false
    setBusy(false)
    if (!r.ok) return setError(r.errors.openingCash ?? r.error)
    await router.invalidate()
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-default-secondary p-4">
      <Card className="w-full max-w-md" padding="large">
        <Text as="h1" variant="h4" weight="bold">
          Buka laci kas
        </Text>
        <p className="mt-1 text-sm text-default-secondary">Hitung uang di laci sebelum mulai berjualan.</p>
        <form onSubmit={submit} noValidate className="mt-5 space-y-4">
          <TextField
            label="Uang awal di laci"
            required
            prefix="Rp"
            inputMode="numeric"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            error={error}
            placeholder="0"
            autoFocus
          />
          <Button htmlType="submit" width="full" size="large" isLoading={busy}>
            Buka shift
          </Button>
          <Button asChild type="text" width="full">
            <Link to="/">Kembali ke dasbor</Link>
          </Button>
        </form>
      </Card>
    </main>
  )
}

type CartLine = CartEntry<Product>
const ALL = 'semua'

type Qris = { configured: boolean; version: string }

function Register({
  products,
  taxBps,
  methods,
  qris,
  chargeable,
}: {
  products: Product[]
  taxBps: number
  methods: PaymentMethod[]
  qris: Qris
  /** UMK-1991: the gateway methods the store may charge now; an online method not in it is not offered. */
  chargeable: string[]
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState(ALL)
  const [cart, setCart] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<Product>()
  const [note, setNote] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [paying, setPaying] = useState(false)
  const [soldOut, setSoldOut] = useState<string>()
  const [paid, setPaid] = useState<PaidSale>()
  // UMK-1991: a PG sale waits for its payment on its own screen; a reload brings the screen back.
  // `own`: the sale was made from the order in this cart; a sale picked from the list is somebody else's order.
  const [waiting, setWaiting] = useState<{ payment: SalePayment; own: boolean } | null>(null)
  const [ownSale, setOwnSale] = useState<string | null>(null)
  const resume = useResumeOnlineSale()
  const [listing, setListing] = useState(false)
  const online = waiting ?? (resume.resumed ? { payment: resume.resumed, own: resume.own } : null)
  useEffect(() => {
    if (resume.resumed && resume.own) setOwnSale(resume.resumed.saleId)
  }, [resume.resumed, resume.own])
  // Order discount (pos-api `discount`): only for actors with sales.price_override; the server ignores it otherwise.
  const canDiscount = useCan('sales.price_override')
  const [discountText, setDiscountText] = useState('')
  const [member, setMember] = useState<MemberOption | null>(null)
  const [voucher, setVoucher] = useState<AppliedVoucher | null>(null)
  // One key per request: a double tap or a retry of the same order sends the same key, so one sale. Any change to the
  // cart, note, member or voucher is a new request and gets a new key (pos-api refuses a known key with another body).
  // The open bill is kept per tab while the cashier visits other pages; restored once on mount (after hydration).
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    const saved = restoreCart(readCart(), products)
    if (saved.lines.length) setCart(saved.lines)
    if (saved.note) setNote(saved.note)
    setRestored(true)
  }, [])
  useEffect(() => {
    if (restored) writeCart({ lines: savedLines(cart), note })
  }, [restored, cart, note])
  const [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => setKey(crypto.randomUUID()), [cart, note, member, voucher, discountText])
  const clearOrder = () => {
    setCart([])
    setNote('')
    setMember(null)
    setVoucher(null)
    setDiscountText('')
  }
  // A reload found the remembered sale already ended: a completed one is rung up (its order leaves the cart and its
  // receipt is offered), a cancelled one only says so.
  useEffect(() => {
    const c = resume.completed
    if (!c) return
    if (c.own) clearOrder()
    setOwnSale(null)
    setKey(crypto.randomUUID())
    void router.invalidate()
    setPaid({ id: c.saleId, change: null, receivableRest: null })
    resume.ack()
  }, [resume.completed])
  useEffect(() => {
    const e = resume.ended
    if (!e) return
    setOwnSale(null)
    setKey(crypto.randomUUID())
    void router.invalidate()
    notifySuccess(`Penjualan #${e.saleNumber} sudah ditutup tanpa pembayaran. Stok kembali.`)
    resume.ack()
  }, [resume.ended])

  const categories = useMemo(
    () =>
      [...new Map(products.map((p) => [p.category.id, p.category.name])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [products],
  )
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter(
      (p) =>
        (category === ALL || p.category.id === category) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)),
    )
  }, [q, category, products])

  // UMK-1985: pos-api prices the cart (unit price, wholesale tier). The quote follows the cart after a short pause;
  // until it answers, lines show the unit's list price. A quote of an older cart is never used.
  const [quote, setQuote] = useState<{ sig: string; quote: Quote }>()
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [quoteTry, setQuoteTry] = useState(0) // bumped by "Coba lagi" to ask the server again
  const sig = cartSignature(cart)
  useEffect(() => {
    if (cart.length === 0) {
      setQuote(undefined)
      setQuoteState('idle')
      return
    }
    let stale = false
    setQuoteState('loading')
    const t = setTimeout(() => {
      quoteCart({ data: requestLines(cart) })
        .then((r) => {
          if (stale) return
          if (r.ok) setQuote({ sig, quote: r.data })
          setQuoteState(r.ok ? 'idle' : 'error')
        })
        .catch(() => !stale && setQuoteState('error'))
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [sig, quoteTry])
  const current = quote?.sig === sig ? quote.quote : null
  const priced = priceEntries(cart, current)
  const hints = wholesaleHints(cart, current)
  const subtotal = subtotalOf(priced)
  const discountBad = canDiscount ? discountError(discountText, subtotal) : undefined
  const discount = canDiscount && !discountBad && discountText.trim() ? parseRupiah(discountText) : 0
  // Estimate shown to the cashier; pos-api computes the charged total the same way: discount, then the voucher on
  // what is left, then tax on the rest (Lakasir flaw 2).
  const voucherDiscount = voucher?.discount ?? 0
  const tax = taxOf(subtotal - discount - voucherDiscount, taxBps)
  const total = subtotal - discount - voucherDiscount + tax
  const qtyOf = (id: string) => baseQtyInCart(cart, id)

  // Stock is only a hint here (pos-api refuses an oversold sale); an empty product says why nothing was added.
  const over = overStock(stockLines(cart))
  useEffect(() => {
    if (!soldOut) return
    const t = setTimeout(() => setSoldOut(undefined), 4000)
    return () => clearTimeout(t)
  }, [soldOut])
  const add = (product: Product) => {
    if (stockState(product.stock, product.lowStockThreshold) === 'out') {
      setSoldOut(`${product.name} habis. Perbarui stok di Pembelian atau Stok opname.`)
      return
    }
    setSoldOut(undefined)
    // A product with other units asks which one first; the base unit is the default choice.
    if (needsUnitPicker(product)) setPicking(product)
    else setCart((c) => addEntry(c, product, null, 1))
  }
  const setQty = (key: string, qty: number) => setCart((c) => setEntryQty(c, key, qty))

  return (
    <main className="grid min-h-svh bg-default-secondary md:grid-cols-[1fr_minmax(320px,380px)]">
      <section aria-label="Produk" className="min-w-0 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button width="auto" asChild type="text" size="small" className="mr-auto">
            <Link to="/">
              <Icon name="arrow-left" size="sm" /> Dasbor
            </Link>
          </Button>
          <div className="w-full sm:w-72">
            <TextField
              aria-label="Cari produk"
              type="search"
              size="small"
              leadingAdornment={<Icon name="search" size="sm" />}
              placeholder="Cari nama atau SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {categories.length > 1 && (
          <div className="overflow-x-auto">
            <Tabs value={category} onValueChange={setCategory} size="xsmall">
              <TabsList label="Kategori">
                <TabsTrigger value={ALL}>Semua</TabsTrigger>
                {categories.map(([id, name]) => (
                  <TabsTrigger key={id} value={id}>
                    {name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
        {soldOut && <ErrorText>{soldOut}</ErrorText>}
        {products.length === 0 ? (
          <Card>
            <Empty
              title="Belum ada produk aktif"
              hint="Tambahkan produk di Katalog untuk mulai berjualan."
              action={
                <Button width="auto" asChild type="outline">
                  <Link to="/catalog/products">Buka katalog</Link>
                </Button>
              }
            />
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <Empty title="Produk tidak ditemukan" hint="Coba kata atau kategori lain." />
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {shown.map((p) => {
              const state = stockState(p.stock, p.lowStockThreshold)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    aria-label={`Tambah ${p.name}`}
                    className={`flex h-full min-h-32 w-full flex-col gap-1 rounded-2xl border border-default-primary bg-default-primary p-3 text-left transition active:scale-[0.98] hover:border-default-brand${state === 'out' ? ' opacity-55' : ''}`}
                  >
                    <span className="text-sm text-default-brand">
                      {rupiah(p.sellingPrice)}
                      {needsUnitPicker(p) && <span className="text-default-secondary"> / {p.unit}</span>}
                    </span>
                    <span className="line-clamp-2 font-semibold text-default-primary">{p.name}</span>
                    <span className="text-xs text-default-secondary">{p.category.name}</span>
                    <span className="text-xs text-default-secondary">
                      {state === 'out' ? (
                        <Badge color="danger" size="small">
                          Habis
                        </Badge>
                      ) : state === 'low' ? (
                        <Badge color="warning" size="small">
                          Sisa {p.stock}
                        </Badge>
                      ) : state === 'enough' ? (
                        `Stok ${p.stock}`
                      ) : (
                        'Tanpa stok'
                      )}
                    </span>
                    <span className="mt-auto flex items-center justify-between pt-2">
                      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-default-brand text-default-invert">
                        <Icon name="plus" size="sm" />
                      </span>
                      {qtyOf(p.id) > 0 && <Badge size="small">{qtyOf(p.id)}</Badge>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <aside
        aria-label="Rincian pesanan"
        className="flex flex-col gap-3 border-default-primary bg-default-primary p-4 md:sticky md:top-0 md:h-svh md:border-l"
      >
        <div className="flex items-center justify-between">
          <Text as="h1" variant="h5" weight="bold" className="whitespace-nowrap">
            Rincian pesanan
          </Text>
          <div className="flex gap-1 whitespace-nowrap">
            <Button width="auto" type="text" size="compact" onClick={() => setListing(true)}>
              Menunggu
            </Button>
            <Button width="auto" asChild type="text" size="compact">
              <Link to="/kasir/riwayat">Riwayat</Link>
            </Button>
            <Button width="auto" asChild type="text" size="compact">
              <Link to="/kasir/kas-laci">Kas laci</Link>
            </Button>
            <Button width="auto" asChild type="text" size="compact" color="danger">
              <Link to="/kasir/tutup">Tutup shift</Link>
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Text as="h2" variant="h6" weight="bold">
            Pesanan
          </Text>
          {(cart.length > 0 || note) && (
            <Button
              width="auto"
              type="text"
              size="compact"
              color="danger"
              onClick={() => {
                setCart([])
                setNote('')
                setDiscountText('')
                setVoucher(null)
                setMember(null)
              }}
            >
              Hapus semua
            </Button>
          )}
        </div>
        <div className="min-h-24 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 rounded-2xl border border-default-primary py-8 text-default-secondary">
              <Icon name="x" size="md" /> Belum ada item
            </div>
          ) : (
            <ul className="space-y-2">
              {cart.map((l, i) => {
                const key = entryKey(l)
                const name = l.unit ? `${l.product.name} (${l.unit})` : l.product.name
                const pl = priced[i]
                const note = savingsNote(pl)
                return (
                  <li key={key} className="rounded-2xl border border-default-primary p-3">
                    <p className="flex justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{l.product.name}</span>
                      <span className="shrink-0 text-default-brand">{rupiah(pl.lineTotal)}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-default-secondary">
                      <span>
                        {l.qty} {unitLabel(l.product, l.unit)} × {rupiah(pl.unitPrice)}
                      </span>
                      {pl.appliedTier && (
                        <Badge color="success" size="small">
                          Harga grosir
                        </Badge>
                      )}
                    </p>
                    {note && <p className="mt-1 text-xs text-default-secondary">{note}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        iconOnly
                        aria-label={`Tambah ${name}`}
                        size="small"
                        onClick={() => setQty(key, l.qty + 1)}
                      >
                        <Icon name="plus" size="sm" />
                      </Button>
                      <QtyField name={name} qty={l.qty} onChange={(n) => setQty(key, n)} />
                      <Button
                        iconOnly
                        aria-label={`Kurangi ${name}`}
                        size="small"
                        type="outline"
                        color="light"
                        onClick={() => setQty(key, l.qty - 1)}
                      >
                        <Icon name="minus" size="sm" />
                      </Button>
                      <Button
                        iconOnly
                        aria-label={`Hapus ${name}`}
                        size="small"
                        type="ghost"
                        color="danger"
                        onClick={() => setQty(key, 0)}
                      >
                        <Icon name="trash" size="sm" />
                      </Button>
                    </div>
                  </li>
                )
              })}
              {hints.map((h) => (
                <li key={`hint-${h.productId}`}>
                  <Alert variant="info" size="small">
                    {h.text}
                  </Alert>
                </li>
              ))}
            </ul>
          )}
        </div>

        <dl className="space-y-2 rounded-2xl border border-default-primary p-3 text-sm">
          <MemberRow member={member} onChange={setMember} />
          <div className="flex items-start justify-between gap-3">
            <dt className="text-default-secondary">Catatan</dt>
            <dd className="min-w-0 text-right">
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                className="max-w-48 truncate text-default-brand hover:underline"
              >
                {note || 'Tambah catatan'}
              </button>
            </dd>
          </div>
          {canDiscount && (
            <div className="flex items-start justify-between gap-3">
              <dt className="pt-1 text-default-secondary">Diskon</dt>
              <dd className="w-36">
                <TextField
                  aria-label="Diskon pesanan"
                  size="xsmall"
                  prefix="Rp"
                  inputMode="numeric"
                  placeholder="0"
                  value={discountText}
                  error={discountBad}
                  onChange={(e) => setDiscountText(e.target.value)}
                />
              </dd>
            </div>
          )}
          <VoucherRow voucher={voucher} amount={subtotal - discount} onChange={setVoucher} />
        </dl>

        <dl className="space-y-2 rounded-2xl border border-default-primary p-3 text-sm">
          <Row
            label={quoteState === 'loading' ? 'Subtotal (menghitung…)' : 'Subtotal'}
            value={<span className="text-default-brand">{rupiah(subtotal)}</span>}
          />
          {discount > 0 && (
            <Row label="Diskon" value={<span className="text-default-brand">−{rupiah(discount)}</span>} />
          )}
          {voucher && (
            <Row label="Voucher" value={<span className="text-default-brand">−{rupiah(voucherDiscount)}</span>} />
          )}
          <Row label="Pajak" value={<span className="text-default-brand">{taxBps / 100}%</span>} />
          <div className="flex justify-between border-t border-default-primary pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="text-default-brand">{rupiah(total)}</dd>
          </div>
        </dl>
        {quoteState === 'error' && (
          <Alert
            variant="warning"
            size="small"
            role="alert"
            action={
              <Button type="outline" color="light" size="small" width="auto" onClick={() => setQuoteTry((n) => n + 1)}>
                Coba lagi
              </Button>
            }
          >
            Harga satuan dan grosir belum bisa dicek ke server, jadi total ini hanya perkiraan dan bisa lebih tinggi
            dari yang ditagihkan. Coba lagi sebelum lanjut ke pembayaran.
          </Alert>
        )}
        {over.length > 0 && (
          <Alert variant="warning" size="small" role="alert">
            {stockOverMessage(over[0].stock ?? 0)}
          </Alert>
        )}
        <Button
          size="large"
          width="full"
          disabled={
            !canProceedToPayment({
              cartSize: cart.length,
              overCount: over.length,
              quoteState,
            })
          }
          onClick={() => (discountBad ? showError({ status: 422, error: `Diskon: ${discountBad}` }, 'melanjutkan ke pembayaran') : setPaying(true))}
        >
          Lanjut ke pembayaran
        </Button>
      </aside>

      <UnitPicker
        product={picking}
        onClose={() => setPicking(undefined)}
        onAdd={(product, unit, qty) => {
          setCart((c) => addEntry(c, product, unit, qty))
          setPicking(undefined)
        }}
      />
      <NoteDialog open={editingNote} note={note} onClose={() => setEditingNote(false)} onSave={setNote} />
      {paying && (
        <PayDialog
          subtotal={subtotal}
          discount={discount}
          taxBps={taxBps}
          tax={tax}
          total={total}
          cart={cart}
          note={note}
          idempotencyKey={key}
          methods={methods}
          chargeable={chargeable}
          qris={qris}
          member={member}
          onMemberChange={setMember}
          voucher={voucher}
          onClose={() => setPaying(false)}
          renewKey={() => setKey(crypto.randomUUID())}
          onAwaiting={(payment) => {
            setPaying(false)
            setOwnSale(payment.saleId)
            setWaiting({ payment, own: true })
          }}
          onPaid={(sale) => {
            void router.invalidate() // fresh prices and products for the next order
            setPaying(false)
            setPaid(sale)
            setCart([])
            setNote('')
            setMember(null)
            setVoucher(null)
            setDiscountText('')
            setKey(crypto.randomUUID())
          }}
        />
      )}
      <SuccessDialog sale={paid} onClose={() => setPaid(undefined)} />
      <AwaitingList
        open={listing}
        onClose={() => setListing(false)}
        onPick={(payment) => setWaiting({ payment, own: payment.saleId === ownSale })}
      />
      <ResumeGate resume={resume} />
      {online && (
        <OnlineWait
          key={online.payment.saleId}
          initial={online.payment}
          own={online.own}
          onFinish={(r: OnlineFinish) => {
            forgetPending()
            setWaiting(null)
            resume.clear()
            void router.invalidate() // stock is back (or sold): fresh products for the next order
            // What the end means for the cart depends on whose sale it was (a picked sale never touches this cart).
            const plan = finishPlan(r.kind === 'paid' ? { kind: 'paid' } : { kind: 'closed', again: r.again }, online.own)
            if (online.own) setOwnSale(null)
            // A new key: the same key would answer the finished sale again.
            if (plan.renewKey) setKey(crypto.randomUUID())
            if (plan.clearCart) clearOrder()
            // Expired or failed: straight to choosing another way to pay, the cart is still there.
            if (plan.openPay) setPaying(true)
          }}
        />
      )}
    </main>
  )
}

/**
 * The cart quantity: free typing (it may be empty while editing), applied only when it is a whole number 1–100.000;
 * anything else is shown as an error and the cart keeps the last good quantity until blur restores it.
 */
function QtyField({ name, qty, onChange }: { name: string; qty: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(qty))
  useEffect(() => setText(String(qty)), [qty])
  const error = qtyError(text)
  return (
    <TextField
      aria-label={`Jumlah ${name}`}
      size="xsmall"
      inputMode="numeric"
      className="w-16"
      value={text}
      error={text === String(qty) ? undefined : error}
      onChange={(e) => {
        setText(e.target.value)
        if (!qtyError(e.target.value)) onChange(Number(e.target.value.trim()))
      }}
      onBlur={() => setText(String(qty))}
    />
  )
}

/** UMK-1985: which unit to add (the base unit is chosen first) and how many of it. Prices are the list prices. */
function UnitPicker({
  product,
  onClose,
  onAdd,
}: {
  product?: Product
  onClose: () => void
  onAdd: (product: Product, unit: string | null, qty: number) => void
}) {
  const [choice, setChoice] = useState('')
  const [qtyText, setQtyText] = useState('1')
  useEffect(() => {
    setChoice('')
    setQtyText('1')
  }, [product?.id])
  const options = product ? unitOptions(product) : []
  const qtyBad = qtyError(qtyText)
  const picked = options.find((o) => (o.unit ?? '') === choice) ?? options[0]
  return (
    <Dialog
      open={!!product}
      onOpenChange={(o) => !o && onClose()}
      centered
      size="small"
      title={product?.name ?? 'Pilih satuan'}
    >
      {product && picked && (
        <form
          noValidate
          className="space-y-4 px-6 pb-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (!qtyBad) onAdd(product, picked.unit, Number(qtyText.trim()))
          }}
        >
          <SelectionCard
            label="Pilih satuan"
            options={options.map((o) => ({
              value: o.unit ?? '',
              label: o.unitQty > 1 ? `${o.label} (isi ${o.unitQty})` : o.label,
              badge: rupiah(o.price),
              description:
                o.saving > 0 ? `Hemat ${rupiah(o.saving)} dibanding ${o.unitQty} ${product.unit}` : undefined,
            }))}
            value={[picked.unit ?? '']}
            onValueChange={(v) => setChoice(v[0] ?? '')}
          />
          <TextField
            label="Jumlah"
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            error={qtyBad}
          />
          <div className="flex justify-end gap-2">
            <Button width="auto" type="outline" color="light" onClick={onClose}>
              Batal
            </Button>
            <Button width="auto" htmlType="submit">
              Tambah ke pesanan
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-default-secondary">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function NoteDialog({
  open,
  note,
  onClose,
  onSave,
}: {
  open: boolean
  note: string
  onClose: () => void
  onSave: (n: string) => void
}) {
  const [text, setText] = useState(note)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? setText(note) : onClose())}
      centered
      size="small"
      title="Catatan pesanan"
    >
      <form
        className="space-y-4 px-6 pb-6"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(text.trim())
          onClose()
        }}
      >
        <TextField
          label="Catatan"
          autoFocus
          multiline
          rows={3}
          maxLength={200}
          showCounter
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button width="auto" type="outline" color="light" onClick={onClose}>
            Batal
          </Button>
          <Button width="auto" htmlType="submit">
            Simpan
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// Lakasir's payment numpad: 7-8-9 on top, 000 for round notes, backspace.
const NUMPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '000', '0', 'hapus'] as const

function PayDialog({
  subtotal,
  discount,
  taxBps,
  tax,
  total,
  cart,
  note,
  idempotencyKey,
  methods: allMethods,
  chargeable,
  qris,
  member,
  onMemberChange,
  voucher,
  onClose,
  onPaid,
  onAwaiting,
  renewKey,
}: {
  subtotal: number
  discount: number
  taxBps: number
  tax: number
  total: number
  cart: CartLine[]
  note: string
  idempotencyKey: string
  methods: PaymentMethod[]
  chargeable: string[]
  qris: Qris
  member: MemberOption | null
  onMemberChange: (m: MemberOption | null) => void
  voucher: AppliedVoucher | null
  onClose: () => void
  onPaid: (sale: PaidSale) => void
  /** UMK-1991: the sale was written and now waits for its QRIS or VA payment. */
  onAwaiting: (payment: SalePayment) => void
  /** The sale this key made is cancelled: the next attempt must not replay it. */
  renewKey: () => void
}) {
  const router = useRouter()
  const { offered: methods, hidden: hiddenOnline } = useMemo(
    () => offeredMethods(allMethods, chargeable),
    [allMethods, chargeable],
  )
  const [paidText, setPaidText] = useState('')
  const [methodId, setMethodId] = useState(() => methods.find((m) => m.kind === 'cash')?.id ?? methods[0]?.id ?? '')
  const method = methods.find((m) => m.id === methodId)
  // Kasbon: paid may be 0 and the rest becomes the member's receivable; debit/wallet: exactly the total.
  const isCredit = method?.kind === 'credit'
  const step = payStepOf(method?.kind)
  const isExact = step === 'confirm' || step === 'online'
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  // UMK-1992: the wallet method shows the store's static QRIS image (or says it is not set).
  const [qrisBroken, setQrisBroken] = useState(false)
  const lock = useRef(false) // state lags a burst of clicks; the ref does not
  // The server computes the total; when it disagrees with this screen (a price changed), its figure is shown and due.
  const [serverTotal, setServerTotal] = useState<number>()
  const due = serverTotal ?? total
  // Cash only: the server rounds the amount due up to the next Rp100 (UMK-1993); other methods pay the exact total.
  const isCash = method?.kind === 'cash'
  const rounding = isCash ? cashRounding(due) : 0
  const payable = due + rounding
  const paid = parseRupiah(paidText)
  const change = Number.isNaN(paid) ? null : paid - payable

  async function pay(amount: number) {
    if (lock.current) return
    if (isCredit) {
      if (!member) return setError('Pilih member untuk kasbon.')
      if (!paidText.trim()) amount = 0 // no down payment
      if (Number.isNaN(amount) || amount >= due) return setError('Kasbon harus menyisakan sisa tagihan.')
    } else if (isExact) {
      amount = due
    } else if (!paidText.trim()) return setError('Wajib diisi: masukkan uang diterima')
    else if (Number.isNaN(amount)) return setError('Harus bilangan bulat rupiah, misalnya 50.000')
    else if (amount < payable) return setError('Uang dibayar kurang dari jumlah yang harus dibayar')
    lock.current = true
    setBusy(true)
    setError(undefined)
    const res = await createSale({
      data: {
        key: saleKey(idempotencyKey, methodId, amount),
        lines: requestLines(cart),
        paid: amount,
        discount: discount > 0 ? discount : undefined,
        note: note || undefined,
        memberId: member?.id,
        voucherCode: voucher?.code,
        paymentMethodId: methodId || undefined,
      },
    }).catch(() => ({
      ok: false as const,
      error: 'Tidak bisa terhubung. Coba lagi: penjualan tidak akan tercatat dua kali.',
      total: undefined,
      errors: undefined,
      status: 0,
      code: undefined,
      saleId: undefined,
    }))
    lock.current = false
    setBusy(false)
    if (!res.ok) {
      // UMK-1991: a PG sale the gateway refused is cancelled for good: this key would only answer it again.
      if (res.status === 409 && res.saleId) renewKey()
      // The sale was written but not charged: remember it, so a reload or the Menunggu list still finds it.
      if (res.status === 503 && res.saleId && step === 'online') rememberPending(res.saleId, true)
      showError(
        res.status === 503 || (res.status === 409 && res.code)
          ? { ...saleFailure(res.status, res.code, res.saleId, step === 'online'), error: res.error }
          : res,
        {
          action: 'menyimpan penjualan',
          // A sale that waits for its payment is repeated with the same key: it is never a second sale.
          retry: res.status === 503 ? () => void pay(amount) : undefined,
        },
      )
      if (res.total !== undefined && res.total !== due) {
        setServerTotal(res.total)
        void router.invalidate() // the grid shows the new prices too
        return setError(`Harga berubah: total terbaru ${rupiah(res.total)}. Periksa lalu bayar lagi.`)
      }
      return setError(res.error)
    }
    const awaiting = res.data.status === 'awaiting_payment' ? parsePayment(res.data.payment) : null
    if (awaiting) {
      notifySuccess('Penjualan dibuat. Menunggu pembayaran pelanggan.')
      return onAwaiting(awaiting)
    }
    notifySuccess('Pembayaran berhasil')
    onPaid({
      id: res.data.id,
      change: Math.max(res.data.change, 0),
      receivableRest: res.data.receivableRest ?? null,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      size="xlarge"
      className="md:max-w-4xl"
      label="Pembayaran"
      closeDisabled={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void pay(paid)
        }}
        className="grid max-h-[88dvh] gap-6 overflow-y-auto p-6 md:grid-cols-[1fr_minmax(0,0.8fr)]"
      >
        <div className="space-y-3">
          <SegmentedControl
            aria-label="Metode pembayaran"
            options={methods.map((m) => ({ value: m.id, label: m.name }))}
            value={methodId}
            onChange={(v) => {
              setMethodId(v)
              setError(undefined)
            }}
          />
          {isCredit && (
            <div className="space-y-1 text-sm">
              <dl>
                <MemberRow member={member} onChange={onMemberChange} />
              </dl>
              <p className={member ? 'text-default-secondary' : 'text-default-error'}>
                {member ? 'Uang muka boleh 0; sisanya menjadi piutang.' : 'Pilih member untuk kasbon.'}
              </p>
            </div>
          )}
          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={<span className="text-default-brand">{rupiah(subtotal)}</span>} />
            {discount > 0 && (
              <Row label="Diskon" value={<span className="text-default-brand">−{rupiah(discount)}</span>} />
            )}
            {voucher && (
              <Row
                label={`Voucher ${voucher.code}`}
                value={<span className="text-default-brand">−{rupiah(voucher.discount)}</span>}
              />
            )}
            <Row label={`Pajak ${taxBps / 100}%`} value={<span className="text-default-brand">{rupiah(tax)}</span>} />
            <div className="flex justify-between border-t border-default-primary pt-2 font-bold">
              <dt>Total</dt>
              <dd className="text-default-brand">{rupiah(due)}</dd>
            </div>
            {rounding > 0 && (
              <>
                <Row label="Pembulatan" value={<span className="text-default-brand">{rupiah(rounding)}</span>} />
                <div className="flex justify-between font-bold">
                  <dt>Harus dibayar</dt>
                  <dd className="text-default-brand">{rupiah(payable)}</dd>
                </div>
              </>
            )}
          </dl>
          {isStaticQris(method?.kind) && (
            <div className="space-y-3 text-center" aria-label="QRIS toko">
              <Text variant="h4" weight="bold">
                {rupiah(due)}
              </Text>
              {qris.configured ? (
                qrisBroken ? (
                  <p role="alert" className="text-sm text-default-error">
                    {QRIS_LOAD_ERROR}
                  </p>
                ) : (
                  <img
                    src={qrisSrc(qris.version)}
                    alt="Kode QRIS toko"
                    onError={() => setQrisBroken(true)}
                    className="mx-auto size-56 rounded-lg bg-white object-contain"
                  />
                )
              ) : (
                <Alert variant="warning" size="small">
                  <span className="font-semibold">QRIS belum diatur.</span> Unggah kode QRIS toko di{' '}
                  <Link to="/pengaturan" className="underline">
                    Pengaturan, tab Pembayaran
                  </Link>
                  .
                </Alert>
              )}
              <p className="text-sm text-default-secondary">{qrisScanHint(rupiah(due))}</p>
              <Alert variant="warning" size="small">
                {QRIS_NO_BANK_CHECK}
              </Alert>
            </div>
          )}
          {step === 'online' && (
            <Alert variant="info" size="small">
              QRIS online dan Virtual Account hanya muncul bila Pembayaran Online aktif dan metodenya menyala. Pelanggan
              bayar dari aplikasi bank atau e-wallet mana pun; status masuk otomatis. Stok dan voucher ditahan sampai
              dibayar atau dibatalkan.
            </Alert>
          )}
          {hiddenOnline > 0 && (
            <p className="text-xs text-default-secondary">
              {hiddenOnline} metode online tidak tampil karena belum aktif di Pembayaran Online toko ini.
            </p>
          )}
          {step !== 'confirm' && step !== 'online' && (
            <>
              <TextField
                label="Uang diterima"
                prefix="Rp"
                inputMode="numeric"
                value={paidText}
                onChange={(e) => setPaidText(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <p className="flex justify-between text-sm">
                <span className="text-default-secondary">{isCredit ? 'Sisa kasbon' : 'Kembalian'}</span>
                <span
                  className={`font-bold ${change !== null && change < 0 ? 'text-default-error' : 'text-default-success'}`}
                >
                  {isCredit
                    ? rupiah(Math.max(due - (Number.isNaN(paid) ? 0 : paid), 0))
                    : change === null
                      ? '—'
                      : change < 0
                        ? `Kurang ${rupiah(-change)}`
                        : rupiah(change)}
                </span>
              </p>
              <div className="grid grid-cols-3 gap-2" aria-label="Nominal cepat">
                {quickAmounts(payable)
                  .filter((n) => n !== payable)
                  .map((n) => (
                    <Button
                      width="auto"
                      key={n}
                      type={paid === n ? 'primary' : 'outline'}
                      color={paid === n ? 'primary' : 'light'}
                      disabled={busy}
                      onClick={() => setPaidText(String(n))}
                    >
                      {rupiah(n)}
                    </Button>
                  ))}
              </div>
              <Button
                width="full"
                type={paid === payable ? 'primary' : 'outline'}
                color={paid === payable ? 'primary' : 'light'}
                disabled={busy}
                onClick={() => setPaidText(String(payable))}
              >
                Uang pas
              </Button>
              <div className="grid grid-cols-3 gap-2" aria-label="Papan angka">
                {NUMPAD.map((k) => (
                  <Button
                    width="auto"
                    key={k}
                    type="ghost"
                    color="light"
                    disabled={busy}
                    aria-label={k === 'hapus' ? 'Hapus angka' : undefined}
                    onClick={() => setPaidText((t) => numpadEdit(t, k))}
                  >
                    {k === 'hapus' ? '⌫' : k}
                  </Button>
                ))}
              </div>
            </>
          )}
          <ErrorText>{error}</ErrorText>
          {busy && step === 'online' && (
            <p className="text-center text-xs text-default-secondary" role="status">
              Membuat {method?.gatewayMethod === 'fake_va' ? 'nomor VA' : 'QRIS'}… tombol dikunci supaya tidak tertagih
              dua kali.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button width="auto" htmlType="submit" size="large" isLoading={busy}>
              {isCredit ? 'Simpan kasbon' : confirmButtonLabel(method?.kind, method?.gatewayMethod)}
            </Button>
            <Button width="auto" size="large" type="outline" color="light" disabled={busy} onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>
        <ul className="hidden space-y-3 md:block" aria-label="Item pesanan">
          {cart.map((l) => (
            <li key={l.product.id} className="flex justify-between gap-3 text-sm">
              <span>
                <span className="block font-semibold">{l.product.name}</span>
                <span className="text-default-secondary">× {l.qty}</span>
              </span>
              <span className="text-default-brand">{rupiah(l.product.sellingPrice * l.qty)}</span>
            </li>
          ))}
          {note && (
            <li className="border-t border-default-primary pt-2 text-sm text-default-secondary">Catatan: {note}</li>
          )}
        </ul>
      </form>
    </Dialog>
  )
}

/** `change` is null when it is not known here (a sale found paid after a reload): the receipt has it. */
type PaidSale = { id: string; change: number | null; receivableRest: number | null }

function SuccessDialog({ sale, onClose }: { sale?: PaidSale; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()} centered size="small" label="Pembayaran berhasil">
      <div className="flex flex-col items-center gap-2 px-6 pb-6 pt-8 text-center">
        <span className="text-default-success">
          <Icon name="check-circle" size="xl" />
        </span>
        <p className="text-default-secondary">Berhasil</p>
        <Text variant="h4" weight="bold">
          {/* A kasbon leaves a balance on the member's receivable, not change. */}
          {sale?.receivableRest
            ? `Sisa kasbon: ${rupiah(sale.receivableRest)}`
            : sale?.change == null
              ? 'Penjualan sudah dibayar'
              : `Kembalian: ${rupiah(sale.change)}`}
        </Text>
        <div className="mt-4 grid w-full grid-cols-2 gap-2">
          <Button
            width="auto"
            onClick={() => sale && void navigate({ to: '/kasir/struk/$id', params: { id: sale.id } })}
          >
            Cetak struk
          </Button>
          <Button width="auto" type="outline" color="light" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
