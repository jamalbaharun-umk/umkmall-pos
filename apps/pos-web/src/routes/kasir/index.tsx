import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
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
import { WhatsappReceiptDialog } from '@/components/whatsapp-dialogs'
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
  hiddenOnlineNote,
  offeredMethods,
  payStepOf,
  qrisScanHint,
  qrisSrc,
  saleToast,
  bankError,
  bankToSend,
  banksFor,
  bankRefusalText,
  QRIS_LOAD_ERROR,
  QRIS_NO_BANK_CHECK,
  type Bank,
} from './-pay-step'
import { getSalePayment } from './-online-api'
import { SinceNotices } from './-since-notices'
import { AwaitingList, OnlineWait, ResumeGate, useResumeChecks, type OnlineFinish } from './-online-pay'
import { closedLabel, holdLabel, keepPolling, parsePayment, receiptLabel, saleFailure, type ResumeDecision, type SalePayment } from './-online'
import {
  canAck,
  finishPlan,
  FORGOTTEN_NOTICE,
  gateOf,
  HELD_SAME_TEXT,
  HELD_STOCK_HINT,
  heldBank,
  holdsStock,
  isOwn,
  NO_ANSWER_TEXT,
  NOT_STORED_TEXT,
  onlineBlocked,
  orderNotice,
  OWN_SALE_OPEN_TEXT,
  paidBy,
  RECORDED_TEXT,
  recordedDescription,
  REQUEST_OUT_TEXT,
  requestOut,
  resumePlan,
  saleAnswerEvent,
  toCheck,
  unseenCompletion,
  type PaidSaleInfo,
  type PendingEvent,
  type SaleAnswer,
  WAITING_ANSWER_HINT,
} from './-pending'
import { usePending, type PendingHandle } from './-pending-store'
import { useLost } from './-use-lost'
import { cashRounding, numpadEdit, parseRupiah, qtyError, quickAmounts } from './-money'
import { DiscountDialog, type DiscountTarget } from './-discount-dialog'
import { QuickProductDialog } from './-quick-product-dialog'
import {
  breakdown,
  discountFields,
  discountLabel,
  lineDiscountState,
  pruneDiscounts,
  type LineDiscount,
} from './-discount'
import { ActionRow } from '@/components/action-row'
import { GuideButton } from '@/components/guide'
import { DailyTargetCard } from '../ringkasan/-panels'

// Lakasir's classic cashier (/member/cashier, not PosV2), full screen: product grid with search and category tabs on
// the left, "Orders details" on the right, then the payment modal (method, quick amounts, numpad, "Pay it") and the
// success modal (change, Print).
export const Route = createFileRoute('/kasir/')({
  // `?menunggu=daftar` opens the waiting list, `?menunggu=<sale id>` that sale's waiting screen (the shift close links here).
  validateSearch: (s: Record<string, unknown>): { menunggu?: string } => ({
    menunggu: typeof s.menunggu === 'string' && /^(daftar|[0-9a-f-]{36})$/i.test(s.menunggu) ? s.menunggu : undefined,
  }),
  loader: () => loadCashier(),
  component: CashierPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function CashierPage() {
  const { shift, products, taxBps, methods, qris, chargeable, onlineUnavailable, banks } = Route.useLoaderData()
  const { menunggu } = Route.useSearch()
  return shift ? (
    <Register products={products} taxBps={taxBps} methods={methods} qris={qris} chargeable={chargeable} onlineUnavailable={onlineUnavailable} banks={banks} open={menunggu} />
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
  onlineUnavailable,
  banks,
  open: openWaiting,
}: {
  products: Product[]
  taxBps: number
  methods: PaymentMethod[]
  qris: Qris
  /** UMK-1991: the gateway methods the store may charge now; an online method not in it is not offered. */
  chargeable: string[]
  /** payment-api gave no answer when the methods were read (so a missing online method is not "belum aktif"). */
  onlineUnavailable: boolean
  /** UMK-2037: by gateway method, the banks to choose from before a virtual account is made. */
  banks: Record<string, Bank[]>
  /** `?menunggu=` of the URL: `daftar` opens the waiting list, a sale id opens that sale (the shift close links here). */
  open?: string
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
  // UMK-1991: a PG sale waits for its payment on its own screen; a reload brings the screen back. Which sales are
  // remembered, which one is the cart's own and which Idempotency-Key the next sale sends is all in `-pending.ts`:
  // this screen only dispatches what happened and reads the state. `payments` is what pos-api last said of each.
  const pend = usePending()
  const [payments, setPayments] = useState<Record<string, SalePayment>>({})
  const [listing, setListing] = useState(false)
  const navigate = useNavigate()
  const lostOpen = useLost()
  // A link from the shift close (UMK-2044): open what it names once, then drop the parameter so a reload does not repeat it.
  useEffect(() => {
    if (!openWaiting) return
    void navigate({ to: '/kasir', search: {}, replace: true })
    if (openWaiting === 'daftar') return setListing(true)
    void getSalePayment({ data: openWaiting })
      .catch(lostOpen)
      .then((r) => {
        if (!r || !r.ok) return showError(r?.failure ?? { status: 0 }, { action: 'membuka penjualan menunggu' })
        if (!keepPolling(r.data)) return notifySuccess(`${closedLabel(r.data.holdNumber)} sudah selesai atau ditutup`)
        track(r.data, { type: 'sale_picked', saleId: r.data.saleId })
      })
  }, [openWaiting])
  const onScreen = pend.state.showing ? payments[pend.state.showing] : undefined
  const online = onScreen ? { payment: onScreen, own: isOwn(pend.state, onScreen.saleId) } : null
  /** One sale becomes known together with its payment: the screen can never show a sale it has no payment of. */
  const known = useRef<Record<string, SalePayment>>({})
  const track = (payment: SalePayment, ev: PendingEvent) => {
    known.current = { ...known.current, [payment.saleId]: payment }
    setPayments(known.current)
    pend.dispatch(ev)
  }
  // A sale that should be on screen but has no payment here (it cannot happen through `track`): ask pos-api again.
  // Both are read when the effect runs, not from the render that scheduled it: the store and this screen's state do
  // not always land in the same render, and an older render would call a sale "unreachable" that is not.
  useEffect(() => {
    const id = pend.current().showing
    if (id && !known.current[id]) pend.dispatch({ type: 'resume_answered', saleId: id, result: 'retry' })
  }, [pend.state.showing, payments])
  // UMK-1990: line discounts, by cart line key; only an actor with sales.price_override gives one (pos-api: 403).
  const canDiscount = useCan('sales.price_override')
  // UMK-2130 "Produk cepat": only an actor who may manage the catalog makes one from the till (pos-api: 403).
  const canQuick = useCan('catalog.manage')
  const [quickOpen, setQuickOpen] = useState(false)
  const [discounts, setDiscounts] = useState<Record<string, LineDiscount>>({})
  const [discounting, setDiscounting] = useState<DiscountTarget>()
  const [member, setMember] = useState<MemberOption | null>(null)
  const [voucher, setVoucher] = useState<AppliedVoucher | null>(null)
  // The open bill is kept per tab while the cashier visits other pages; restored once on mount (after hydration).
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    const saved = restoreCart(readCart(), products)
    if (saved.lines.length) setCart(saved.lines)
    if (saved.note) setNote(saved.note)
    setDiscounts(saved.discounts)
    setRestored(true)
  }, [])
  // A removed line takes its discount with it (not before the restore: the first render's empty cart would drop them).
  const keys = cart.map(entryKey)
  useEffect(() => {
    if (restored) setDiscounts((d) => pruneDiscounts(d, keys))
  }, [restored, keys.join('|')])
  // Kind and value only: a PIN approval never leaves this screen's memory.
  const savedDiscounts = Object.fromEntries(Object.entries(discounts).map(([k, d]) => [k, { kind: d.kind, value: d.value }]))
  useEffect(() => {
    if (restored) writeCart({ lines: savedLines(cart), note, discounts: savedDiscounts })
  }, [restored, cart, note, JSON.stringify(savedDiscounts)])
  // The cashier changed the order (not the first render, nor the restore after a reload): the reducer decides whether
  // that is another sale. The Idempotency-Key is never made or kept here.
  const orderSig = JSON.stringify([savedLines(cart), note, member?.id ?? null, voucher?.code ?? null, discounts])
  const lastOrderSig = useRef<string | null>(null)
  useEffect(() => {
    if (!restored) return
    if (lastOrderSig.current !== null && lastOrderSig.current !== orderSig) pend.dispatch({ type: 'cart_edited' })
    lastOrderSig.current = orderSig
  }, [restored, orderSig])
  // A paid answer for the cart's own key finishes this screen, also when the request was sent from a screen that is
  // gone by now (UMK-2048): the answer lands in the tab's one store, and every register that opened before it reacts.
  // One that arrived while the cashier was away (no register mounted) is still unseen when the register opens: the
  // receipt and change are shown then, and the cart is cleared (UMK-2053).
  useEffect(() => {
    if (!restored) return
    const done = unseenCompletion(pend.current())
    if (!done) return
    pend.dispatch({ type: 'completed_seen' })
    void router.invalidate() // fresh prices and products for the next order
    if (done.clearCart) {
      clearOrder()
      setPaying(false)
    }
    if (done.sale) setPaid(done.sale)
  }, [restored, pend.state.completed?.seq])
  const clearOrder = () => {
    setCart([])
    setNote('')
    setMember(null)
    setVoucher(null)
    setDiscounts({})
  }
  // The answers about the sales that had to be checked (after a reload, or put aside): a completed one is rung up (its
  // order leaves the cart only when the cart is still its order, and its receipt is offered), an ended one only says so.
  const onResume = (saleId: string, d: ResumeDecision) => {
    const plan = resumePlan(pend.current(), saleId, d.do)
    if (d.do === 'wait') return track(d.payment, { type: 'resume_answered', saleId, result: 'wait' })
    pend.dispatch({ type: 'resume_answered', saleId, result: d.do })
    if (!plan.known || d.do === 'retry') return
    void router.invalidate()
    // Not this account's sale (pos-api hides another cashier's sale as 404), or gone: said once, never silently dropped.
    if (d.do === 'forget') showError({ status: 404 }, { action: 'memeriksa penjualan sebelumnya' }, () => FORGOTTEN_NOTICE)
    if (d.do === 'completed') {
      if (plan.clearCart) {
        clearOrder()
        setPaying(false)
      }
      setPaid({
        id: d.saleId,
        change: null,
        receivableRest: null,
        receiptNumber: d.receiptNumber,
        amount: d.amount,
        method: d.paymentMethodName,
      })
    }
    if (d.do === 'ended')
      notifySuccess(
        d.reversed
          ? `${receiptLabel(d.receiptNumber)} sudah dibatalkan dan dananya dikembalikan selagi kasir ini terputus. Lihat di Riwayat.`
          : `${closedLabel(d.holdNumber)} sudah ditutup tanpa pembayaran. Stok kembali.`,
      )
  }
  const checks = useResumeChecks(toCheck(pend.state), onResume)

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
  // The quote prices the lines at the server's unit and tier price; the discount of each line is computed on that
  // (the same rule as pos-api) and sent with it, so the server checks it too. One that no longer fits is not sent.
  const listPriced = priceEntries(cart, quote?.sig ? quote.quote : null)
  const quoteLines = requestLines(cart).map((l, i) => {
    const d = discounts[entryKey(cart[i])]
    return lineDiscountState(listPriced[i].lineTotal, d, cart[i].qty).problem ? l : { ...l, ...discountFields(d, false) }
  })
  const sig = cartSignature(cart) + JSON.stringify(quoteLines)
  useEffect(() => {
    if (cart.length === 0) {
      setQuote(undefined)
      setQuoteState('idle')
      return
    }
    let stale = false
    setQuoteState('loading')
    const t = setTimeout(() => {
      quoteCart({ data: quoteLines })
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
  const lineStates = priced.map((pl, i) => lineDiscountState(pl.lineTotal, discounts[entryKey(cart[i])], cart[i].qty))
  const lineDiscount = lineStates.reduce((n, d) => n + d.discount, 0)
  const discountProblem = lineStates.find((d) => d.problem)?.problem
  // Estimate shown to the cashier; pos-api computes the charged total the same way: line discounts, then the voucher
  // on what is left, then tax after every discount (Lakasir flaw 2), then cash rounding at payment.
  const voucherDiscount = voucher?.discount ?? 0
  const { afterDiscount, tax, total } = breakdown({ subtotal, lineDiscount, voucherDiscount, taxBps })
  const cashTotalRounding = cashRounding(total)
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
    <main className="grid min-h-svh bg-default-secondary md:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <section aria-label="Produk" className="min-w-0 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button width="auto" asChild type="text" size="small" className="mr-auto">
            <Link to="/">
              <Icon name="arrow-left" size="sm" /> Dasbor
            </Link>
          </Button>
          <GuideButton />
          <div className="w-full sm:w-72" data-guide="kasir-search">
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
          {canQuick && (
            <Button width="auto" type="outline" size="small" onClick={() => setQuickOpen(true)}>
              <Icon name="plus" size="sm" /> Produk cepat
            </Button>
          )}
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
                <ActionRow>
                  <Button width="auto" asChild type="outline">
                    <Link to="/catalog/products">Buka katalog</Link>
                  </Button>
                  {canQuick && (
                    <Button width="auto" onClick={() => setQuickOpen(true)}>
                      Tambah produk cepat
                    </Button>
                  )}
                </ActionRow>
              }
            />
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <Empty
              title="Produk tidak ditemukan"
              hint={canQuick ? 'Jual dulu: tambahkan sebagai produk cepat, lengkapi modal nanti.' : 'Coba kata atau kategori lain.'}
              action={
                canQuick && (
                  <Button width="auto" type="outline" onClick={() => setQuickOpen(true)}>
                    Tambah produk cepat
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-guide="kasir-products">
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
        data-guide="kasir-cart"
        className="flex min-w-0 flex-col gap-3 border-default-primary bg-default-primary p-4 md:sticky md:top-0 md:h-svh md:border-l"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <Text as="h1" variant="h5" weight="bold">
            Rincian pesanan
          </Text>
          <div className="flex flex-wrap gap-1">
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
          <SinceNotices ownIds={pend.state.sales.map((t) => t.id)} />
        </div>
        {!pend.durable && (
          <Alert variant="warning" size="small" role="alert">
            {NOT_STORED_TEXT}
          </Alert>
        )}
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
                clearOrder()
                // The order is given up, not the sales made from it: those stay remembered until pos-api ends them.
                pend.dispatch({ type: 'order_cleared' })
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
                const d = discounts[key]
                const ds = lineStates[i]
                const qtyText = `${l.qty} ${unitLabel(l.product, l.unit)} × ${rupiah(pl.unitPrice)}`
                return (
                  <li key={key} className="rounded-2xl border border-default-primary p-3">
                    <p className="flex justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{l.product.name}</span>
                      {ds.discount > 0 ? (
                        <span className="flex shrink-0 flex-col items-end leading-tight">
                          <s className="text-xs text-default-secondary">{rupiah(pl.lineTotal)}</s>
                          <span className="text-default-brand">{rupiah(ds.netTotal)}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-default-brand">{rupiah(pl.lineTotal)}</span>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-default-secondary">
                      <span>
                        {qtyText}
                        {d && ds.discount > 0 && ` · ${discountLabel(d)}`}
                      </span>
                      {pl.appliedTier && (
                        <Badge color="success" size="small">
                          Harga grosir
                        </Badge>
                      )}
                      {d && ds.discount > 0 && (
                        <Badge color="warning" size="small">
                          {d.kind === 'price' ? 'Harga manual' : 'Diskon'}
                        </Badge>
                      )}
                    </p>
                    {note && <p className="mt-1 text-xs text-default-secondary">{note}</p>}
                    {ds.problem && (
                      <p role="alert" className="mt-1 text-xs text-default-error">
                        {ds.problem}
                      </p>
                    )}
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
                      {canDiscount && (
                        <Button
                          width="auto"
                          type="text"
                          size="compact"
                          className="ml-auto"
                          aria-label={`${d ? 'Ubah diskon' : 'Beri diskon'} ${name}`}
                          onClick={() =>
                            setDiscounting({
                              key,
                              productId: l.product.id,
                              name: l.product.name,
                              qtyText,
                              qty: l.qty,
                              unitPrice: pl.unitPrice,
                              lineTotal: pl.lineTotal,
                              current: d,
                            })
                          }
                        >
                          {d ? 'Ubah diskon' : 'Beri diskon'}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
              {!canDiscount && (
                <li className="px-1 text-xs text-default-secondary">
                  Anda belum punya izin memberi diskon. Minta admin atau pemilik.
                </li>
              )}
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
          <VoucherRow voucher={voucher} amount={subtotal - lineDiscount} onChange={setVoucher} />
        </dl>

        <dl className="space-y-2 rounded-2xl border border-default-primary p-3 text-sm" data-guide="kasir-total">
          <Row
            label={quoteState === 'loading' ? 'Subtotal (menghitung…)' : 'Subtotal'}
            value={<span className="text-default-brand">{rupiah(subtotal)}</span>}
          />
          {lineDiscount > 0 && (
            <Row label="Diskon baris" value={<span className="text-default-brand">{rupiah(-lineDiscount)}</span>} />
          )}
          {voucher && (
            <Row
              label={`Diskon voucher ${voucher.code}`}
              value={<span className="text-default-brand">{rupiah(-voucherDiscount)}</span>}
            />
          )}
          {(lineDiscount > 0 || voucher) && (
            <Row label="Setelah diskon" value={<span className="text-default-brand">{rupiah(afterDiscount)}</span>} />
          )}
          <Row label={`Pajak ${taxBps / 100}%`} value={<span className="text-default-brand">{rupiah(tax)}</span>} />
          {cashTotalRounding > 0 && (
            <Row label="Pembulatan tunai" value={<span className="text-default-brand">{rupiah(cashTotalRounding)}</span>} />
          )}
          <div className="flex justify-between border-t border-default-primary pt-2 text-base font-bold">
            <dt>{cashTotalRounding > 0 ? 'Total tunai' : 'Total'}</dt>
            <dd className="text-default-brand">{rupiah(total + cashTotalRounding)}</dd>
          </div>
          {cashTotalRounding > 0 && (
            <p className="text-xs text-default-secondary">Non-tunai {rupiah(total)}, tanpa pembulatan.</p>
          )}
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
        {discountProblem && (
          <Alert variant="warning" size="small" role="alert">
            {discountProblem}
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
            }) || !!discountProblem
          }
          onClick={() => setPaying(true)}
          data-guide="kasir-pay"
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
      <QuickProductDialog
        open={quickOpen}
        initialName={q.trim()}
        onClose={() => setQuickOpen(false)}
        onCreated={(product) => {
          setQuickOpen(false)
          setQ('')
          setCart((c) => addEntry(c, product, null, 1))
          void router.invalidate() // the grid lists it from now on
        }}
      />
      <NoteDialog open={editingNote} note={note} onClose={() => setEditingNote(false)} onSave={setNote} />
      <DiscountDialog
        target={discounting}
        onClose={() => setDiscounting(undefined)}
        onApply={(key, d) => setDiscounts((all) => ({ ...all, [key]: d }))}
        onRemove={(key) =>
          setDiscounts((all) => {
            const { [key]: _gone, ...rest } = all
            return rest
          })
        }
      />
      {paying && (
        <PayDialog
          subtotal={subtotal}
          lineDiscount={lineDiscount}
          afterDiscount={afterDiscount}
          discounts={discounts}
          lineAmounts={priced.map((pl, i) => {
            const d = discounts[entryKey(cart[i])]
            return {
              gross: pl.lineTotal,
              net: lineStates[i].netTotal,
              label: d && lineStates[i].discount > 0 ? discountLabel(d) : undefined,
            }
          })}
          onApprovalLost={(i) => {
            // pos-api no longer takes the line's PIN approval (expired, used): the line asks for the PIN again.
            const key = entryKey(cart[i])
            setDiscounts((all) => (all[key] ? { ...all, [key]: { kind: all[key].kind, value: all[key].value } } : all))
            setPaying(false)
          }}
          taxBps={taxBps}
          tax={tax}
          total={total}
          cart={cart}
          note={note}
          pend={pend}
          methods={methods}
          chargeable={onlineBlocked(pend.state) ? [] : chargeable}
          onlineUnavailable={onlineUnavailable}
          banks={banks}
          onlineBlocked={onlineBlocked(pend.state)}
          qris={qris}
          member={member}
          onMemberChange={setMember}
          voucher={voucher}
          onClose={() => setPaying(false)}
          onClearOrder={clearOrder}
          onAwaiting={(payment, ev) => {
            setPaying(false)
            track(payment, ev)
          }}
        />
      )}
      <SuccessDialog sale={paid} onClose={() => setPaid(undefined)} />
      <AwaitingList
        durable={pend.durable}
        open={listing}
        onClose={() => setListing(false)}
        onPick={(payment) => track(payment, { type: 'sale_picked', saleId: payment.saleId })}
      />
      <ResumeGate gate={gateOf(pend.state)} onRetry={checks.retry} onAside={() => pend.dispatch({ type: 'set_aside' })} />
      {online && (
        <OnlineWait
          key={online.payment.saleId}
          initial={online.payment}
          own={online.own}
          onFinish={(r: OnlineFinish) => {
            // What the end means for the cart depends on whose sale it was, read before the sale is forgotten (a
            // picked sale, or one the order moved on from, never touches this cart). Only this sale is forgotten.
            const plan = finishPlan(
              pend.current(),
              r.saleId,
              r.kind === 'paid' ? { kind: 'paid' } : { kind: 'closed', again: r.again },
            )
            pend.dispatch({ type: 'sale_finished', saleId: r.saleId })
            const { [r.saleId]: _done, ...rest } = known.current
            known.current = rest
            setPayments(rest)
            void router.invalidate() // stock is back (or sold): fresh products for the next order
            if (plan.clearCart) {
              clearOrder()
              setPaying(false)
            }
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
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6"
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
          <ActionRow>
            <Button width="auto" type="outline" color="light" onClick={onClose}>
              Batal
            </Button>
            <Button width="auto" htmlType="submit">
              Tambah ke pesanan
            </Button>
          </ActionRow>
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
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6"
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
        <ActionRow>
          <Button width="auto" type="outline" color="light" onClick={onClose}>
            Batal
          </Button>
          <Button width="auto" htmlType="submit">
            Simpan
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

// Lakasir's payment numpad: 7-8-9 on top, 000 for round notes, backspace.
const NUMPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '000', '0', 'hapus'] as const

const BLOCKED_TEXT = { recorded: RECORDED_TEXT, request_out: REQUEST_OUT_TEXT, own_sale_open: OWN_SALE_OPEN_TEXT }

function PayDialog({
  subtotal,
  lineDiscount,
  afterDiscount,
  discounts,
  lineAmounts,
  onApprovalLost,
  taxBps,
  tax,
  total,
  cart,
  note,
  pend,
  methods: allMethods,
  chargeable,
  onlineUnavailable,
  banks,
  qris,
  member,
  onMemberChange,
  voucher,
  onClose,
  onClearOrder,
  onAwaiting,
  onlineBlocked,
}: {
  subtotal: number
  /** UMK-1990: the cart's line discounts, and the amount after them and the voucher (tax comes after both). */
  lineDiscount: number
  afterDiscount: number
  discounts: Record<string, LineDiscount>
  /** Each cart line at the server's price (`gross`) and after its discount (`net`), with the discount's label. */
  lineAmounts: { gross: number; net: number; label?: string }[]
  /** The sale was refused because line `index` lost its PIN approval. */
  onApprovalLost: (index: number) => void
  taxBps: number
  tax: number
  total: number
  cart: CartLine[]
  note: string
  /** The register's memory of unfinished sales: the key of each request is read from it when the request is sent. */
  pend: PendingHandle
  methods: PaymentMethod[]
  chargeable: string[]
  onlineUnavailable: boolean
  banks: Record<string, Bank[]>
  qris: Qris
  member: MemberOption | null
  onMemberChange: (m: MemberOption | null) => void
  voucher: AppliedVoucher | null
  onClose: () => void
  /** Empties the cart and its member, voucher and discount (the order is over). */
  onClearOrder: () => void
  /** UMK-1991: the sale was written and now waits for its QRIS or VA payment (`ev` is that fact for the memory). */
  onAwaiting: (payment: SalePayment, ev: PendingEvent) => void
  /** A sale remembered before a reload is still unchecked: online methods wait (cash is never blocked). */
  onlineBlocked: boolean
}) {
  const lost = useLost()
  const router = useRouter()
  const { offered: methods, hidden: hiddenOnline } = useMemo(
    () => offeredMethods(allMethods, chargeable),
    [allMethods, chargeable],
  )
  const hiddenNote = hiddenOnlineNote(hiddenOnline, onlineUnavailable)
  const [paidText, setPaidText] = useState('')
  const [methodId, setMethodId] = useState(() => methods.find((m) => m.kind === 'cash')?.id ?? methods[0]?.id ?? '')
  const method = methods.find((m) => m.id === methodId)
  // UMK-2037: a virtual account is made for one bank, chosen before it is created; a method without banks needs none.
  // A held VA sale (written, its charge unanswered) is repeated with the same bank: it is chosen again for the cashier.
  const [bankCode, setBankCode] = useState(() => heldBank(pend.state, methodId))
  const bankList = useMemo(() => (method?.kind === 'online' ? banksFor(banks, method.gatewayMethod) : []), [banks, method])
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
    // The key is read from the register's memory NOW, never from this render: the error dialog's "Coba lagi" runs an
    // older closure of this function, and must still send the key of the sale that was last written.
    const online = step === 'online'
    const bank = online ? bankToSend(bankList, bankCode) : null
    const missing = online ? bankError(bankList, bankCode) : undefined
    if (missing) return setError(missing)
    const plan = pend.send(methodId, bank)
    if ('blocked' in plan) return setError(BLOCKED_TEXT[plan.blocked])
    const sendKey = plan.key
    lock.current = true
    setBusy(true)
    setError(undefined)
    const res = await createSale({
      data: {
        key: sendKey,
        lines: requestLines(cart).map((l, i) => ({ ...l, ...discountFields(discounts[entryKey(cart[i])], true) })),
        paid: amount,
        note: note || undefined,
        memberId: member?.id,
        voucherCode: voucher?.code,
        paymentMethodId: methodId || undefined,
        bank: bank ?? undefined,
      },
    }).catch((e: unknown) => {
      lost(e) // a sign-in redirect is followed; any other failure is "no answer"
      return {
      ok: false as const,
      error: NO_ANSWER_TEXT,
      total: undefined,
      errors: undefined,
      status: 0,
      code: undefined,
      saleId: undefined,
      }
    })
    lock.current = false
    setBusy(false)
    const paymentOf = res.ok && res.data.status === 'awaiting_payment' ? parsePayment(res.data.payment) : null
    const answer: SaleAnswer = res.ok
      ? res.data.status === 'awaiting_payment'
        ? { ok: true, awaiting: true, saleId: res.data.id, readable: paymentOf !== null }
        : { ok: true, awaiting: false }
      : { ok: false, status: res.status ?? 0, saleId: res.saleId, error: res.error }
    // What the answer means for the key and the remembered sales is decided in `-pending.ts` (a cancelled sale's key
    // is spent, a sale written but not charged is kept, another body under a used key means a sale already exists).
    const ev = saleAnswerEvent(pend.current(), { key: sendKey, methodId, online, bank }, answer)
    if (!res.ok) {
      pend.dispatch(ev)
      if (ev.type === 'sale_mismatch') {
        // The first sale exists (or may): never a silent dead end. The dialog and the notice above the button say so.
        showError(res, { action: 'menyimpan penjualan' }, () => recordedDescription(res.error))
        return setError(RECORDED_TEXT)
      }
      // UMK-1990: a line's PIN approval ran out or was used: that line asks for the PIN again before the next try.
      const lostApproval = Object.keys(res.errors ?? {})
        .map((k) => /^lines\.(\d+)\.discountApprovalId$/.exec(k)?.[1])
        .find((n) => n !== undefined)
      if (res.status === 422 && lostApproval !== undefined) {
        showError(res, { action: 'menyimpan penjualan' })
        return onApprovalLost(Number(lostApproval))
      }
      // pos-api's 422 on `bank` (UMK-2037): the bank list moved on, the sale (if one was written) is cancelled.
      if (res.status === 422 && res.errors?.bank) {
        setBankCode('')
        const text = bankRefusalText(res.code)
        showError({ status: 422, error: text, todo: 'Pilih bank atau metodenya lagi, lalu coba lagi.' }, { action: 'membuat nomor VA' })
        void router.invalidate() // the banks are read again
        return setError(text)
      }
      showError(
        res.status === 503 || (res.status === 409 && res.code)
          ? { ...saleFailure(res.status, res.code, res.saleId, online), error: res.error }
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
      // A sale written but never charged still holds its stock: say why a last unit is refused.
      const stockHeld = res.status === 409 && !res.saleId && holdsStock(pend.current())
      return setError(stockHeld ? `${res.error} ${HELD_STOCK_HINT}` : res.error)
    }
    if (res.data.status === 'awaiting_payment') {
      notifySuccess('Penjualan dibuat. Menunggu pembayaran pelanggan.')
      if (paymentOf) return onAwaiting(paymentOf, ev)
      // Written and waiting, but its payment could not be read: it is remembered and asked for again, never "paid".
      pend.dispatch(ev)
      return onClose()
    }
    // The register's effect finishes the screen from the store (receipt, cart, fresh prices), also a new screen when
    // this one was left mid-request. The stored bill of a paid order must not come back to be rung again.
    const before = pend.current()
    const after = pend.dispatch({
      type: 'sale_paid',
      key: sendKey,
      sale: { id: res.data.id, change: Math.max(res.data.change, 0), receivableRest: res.data.receivableRest ?? null },
    })
    // Only what THIS answer produced: for a key the order moved on from, `completed` is an older sale's (UMK-2053).
    if (paidBy(before, after)?.clearCart) writeCart({ lines: [], note: '' })
    notifySuccess(saleToast(amount, res.data.receivableRest, rupiah))
  }
  const notice = orderNotice(pend.state)

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
            // Six methods are wider than a phone: wrap them instead of pushing the sheet sideways (UMK-2056).
            className="flex max-w-full flex-wrap rounded-ds-xl"
            options={methods.map((m) => ({ value: m.id, label: m.name }))}
            value={methodId}
            onChange={(v) => {
              setMethodId(v)
              setBankCode(heldBank(pend.state, v))
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
            {lineDiscount > 0 && (
              <Row label="Diskon baris" value={<span className="text-default-brand">{rupiah(-lineDiscount)}</span>} />
            )}
            {voucher && (
              <Row
                label={`Diskon voucher ${voucher.code}`}
                value={<span className="text-default-brand">{rupiah(-voucher.discount)}</span>}
              />
            )}
            {(lineDiscount > 0 || voucher) && (
              <Row label="Setelah diskon" value={<span className="text-default-brand">{rupiah(afterDiscount)}</span>} />
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
          {step === 'online' && bankList.length > 0 && (
            <fieldset className="space-y-2" aria-label="Bank Virtual Account">
              <legend className="text-sm font-semibold">Pilih bank pelanggan</legend>
              <div className="flex flex-wrap gap-2">
                {bankList.map((b) => (
                  <Chip
                    key={b.code}
                    state={bankCode === b.code ? 'active' : 'default'}
                    disabled={busy}
                    onClick={() => {
                      setBankCode(b.code)
                      setError(undefined)
                    }}
                  >
                    {b.name}
                  </Chip>
                ))}
              </div>
              <p className="text-xs text-default-secondary">
                Nomor VA dibuat khusus untuk bank yang dipilih, jadi tanyakan dulu bank pelanggan.
              </p>
            </fieldset>
          )}
          {step === 'online' && (
            <Alert variant="info" size="small">
              QRIS online dan Virtual Account hanya muncul bila Pembayaran Online aktif dan metodenya menyala. Pelanggan
              bayar dari aplikasi bank atau e-wallet mana pun; status masuk otomatis. Stok dan voucher ditahan sampai
              dibayar atau dibatalkan.
            </Alert>
          )}
          {onlineBlocked && (
            <p className="text-xs text-default-secondary" role="status">
              Pembayaran online ditahan sampai penjualan online sebelumnya selesai diperiksa. Tunai tetap bisa dipakai.
            </p>
          )}
          {!onlineBlocked && hiddenNote && (
            <p className="text-xs text-default-secondary" role="status">
              {hiddenNote.text}{' '}
              {hiddenNote.retry && (
                <Button type="text" size="small" width="auto" onClick={() => void router.invalidate()}>
                  Coba lagi
                </Button>
              )}
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
          {!pend.durable && (
            <Alert variant="warning" size="small" role="alert">
              {NOT_STORED_TEXT}
            </Alert>
          )}
          {notice && (
            <Alert variant="warning" size="small" role="alert">
              {notice === 'own_sale_open' ? OWN_SALE_OPEN_TEXT : notice === 'held_same' ? HELD_SAME_TEXT : RECORDED_TEXT}
              {notice === 'recorded' && (
                <ActionRow align="start" className="mt-2">
                  <Button asChild type="outline" color="light" size="small" width="auto">
                    <Link to="/kasir/riwayat">Buka Riwayat</Link>
                  </Button>
                  <Button
                    type="outline"
                    color="light"
                    size="small"
                    width="auto"
                    // not while a request of this page load is still out: its answer says what happened to the sale
                    disabled={busy || !canAck(pend.state)}
                    onClick={() => {
                      pend.dispatch({ type: 'recorded_acked' })
                      setError(undefined)
                    }}
                  >
                    Sudah saya cek: buat penjualan baru
                  </Button>
                  {/* The sale of these lines is already recorded: the cart must not carry them into the next sale (UMK-2053). */}
                  <Button
                    type="outline"
                    color="light"
                    size="small"
                    width="auto"
                    disabled={busy || !canAck(pend.state)}
                    onClick={() => {
                      pend.dispatch({ type: 'recorded_acked' })
                      onClearOrder()
                      setError(undefined)
                      onClose()
                    }}
                  >
                    Sudah tercatat: kosongkan keranjang
                  </Button>
                  {!canAck(pend.state) && (
                    <span className="self-center text-xs" role="status">
                      {WAITING_ANSWER_HINT}
                    </span>
                  )}
                </ActionRow>
              )}
            </Alert>
          )}
          <ErrorText>{error}</ErrorText>
          {busy && step === 'online' && (
            <p className="text-center text-xs text-default-secondary" role="status">
              Membuat {method?.gatewayMethod === 'fake_va' ? 'nomor VA' : 'QRIS'}… tombol dikunci supaya tidak tertagih
              dua kali.
            </p>
          )}
          <ActionRow>
            <Button width="auto" size="large" type="outline" color="light" disabled={busy} onClick={onClose}>
              Tutup
            </Button>
            <Button width="auto" htmlType="submit" size="large" isLoading={busy} disabled={requestOut(pend.state)}>
              {isCredit ? 'Simpan kasbon' : confirmButtonLabel(method?.kind, method?.gatewayMethod)}
            </Button>
          </ActionRow>
        </div>
        <ul className="hidden space-y-3 md:block" aria-label="Item pesanan">
          {cart.map((l, i) => (
            <li key={entryKey(l)} className="flex justify-between gap-3 text-sm">
              <span>
                <span className="block font-semibold">{l.product.name}</span>
                <span className="text-default-secondary">
                  × {l.qty}
                  {l.unit ? ` ${l.unit}` : ''}
                  {lineAmounts[i]?.label ? ` · ${lineAmounts[i].label}` : ''}
                </span>
              </span>
              {/* UMK-1990: the line at the server's price, after its discount (struck through before it). */}
              <span className="text-right text-default-brand">
                {lineAmounts[i] && lineAmounts[i].net < lineAmounts[i].gross && (
                  <s className="block text-xs text-default-secondary">{rupiah(lineAmounts[i].gross)}</s>
                )}
                {rupiah(lineAmounts[i]?.net ?? l.product.sellingPrice * l.qty)}
              </span>
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
type PaidSale = PaidSaleInfo

function SuccessDialog({ sale, onClose }: { sale?: PaidSale; onClose: () => void }) {
  const navigate = useNavigate()
  // UMK-1987: the receipt offered on WhatsApp, on top of this dialog (the paid sale stays on screen behind it).
  const [sharing, setSharing] = useState(false)
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
        {/* Feature 39: today's progress against the owner's optional daily target. */}
        {sale && (
          <div className="w-full text-left">
            <DailyTargetCard />
          </div>
        )}
        {/* A sale found paid after the till was away: say which sale it is, for how much and its receipt (UMK-2058). */}
        {sale && (sale.receiptNumber != null || sale.amount != null) && (
          <dl className="w-full space-y-1 text-sm" aria-label="Rincian penjualan">
            {sale.receiptNumber != null && <Row label="Struk" value={`#${sale.receiptNumber}`} />}
            {sale.amount != null && <Row label="Total dibayar" value={rupiah(sale.amount)} />}
            {sale.method && <Row label="Cara bayar" value={sale.method} />}
          </dl>
        )}
        {/* Three buttons do not fit this small dialog in one row: a column at every width. */}
        <ActionRow stacked className="mt-4">
          <Button width="auto" type="outline" color="light" onClick={onClose}>
            Tutup
          </Button>
          <Button width="auto" type="outline" color="light" disabled={!sale} onClick={() => setSharing(true)}>
            Kirim struk WhatsApp
          </Button>
          <Button
            width="auto"
            onClick={() => sale && void navigate({ to: '/kasir/struk/$id', params: { id: sale.id } })}
          >
            Cetak struk
          </Button>
        </ActionRow>
      </div>
      {sharing && sale && <WhatsappReceiptDialog saleId={sale.id} onClose={() => setSharing(false)} />}
    </Dialog>
  )
}
