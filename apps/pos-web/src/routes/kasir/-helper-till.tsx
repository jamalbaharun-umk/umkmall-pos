import { useNavigate, useRouter } from '@tanstack/react-router'
import { Alert, Badge, Button, Card, Dialog, Icon, SegmentedControl, Text, TextField } from '@umkmall/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { GuideButton } from '@/components/guide'
import { Empty, ErrorText, rupiah } from '@/components/pos-page'
import { useHelper } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { switchSessionAndReload } from '@/lib/session-signal'
import { createSale, endHelper, quoteCart, type PaymentMethod, type Product } from './-api'
import { breakdown } from './-discount'
import {
  addEntry,
  baseQtyInCart,
  cartSignature,
  entryKey,
  needsUnitPicker,
  priceEntries,
  requestLines,
  subtotalOf,
  unitLabel,
  type CartEntry,
  type Quote,
} from './-helpers'
import { endsAtText, helperMethods, helperPaid, helperTitle, pinFailure, pinInputError, RETURN_TOAST } from './-helper'
import { QtyField, UnitPicker } from './-line-fields'
import { cashRounding, quickAmounts } from './-money'
import { confirmButtonLabel, isStaticQris, QRIS_LOAD_ERROR, QRIS_NO_BANK_CHECK, qrisScanHint, qrisSrc } from './-pay-step'
import { stockState } from './-stock'
import { pinDigits } from './-void-helpers'

// UMK-2124 "Serahkan ke pembantu" (design 42): the till a helper sees while the owner's session is parked. Products,
// cart and Bayar only: no menu, no discount, no manual price, no voucher, member or kasbon, no online payment, no
// drawer or shift actions. pos-api refuses all of those for a helper session anyway; this screen just never offers
// them. "Kembali ke pemilik" asks for the owner's PIN.

type Line = CartEntry<Product>
type Qris = { configured: boolean; version: string }
const NO_ANSWER = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'

export function HelperTill({
  products,
  taxBps,
  methods: allMethods,
  qris,
  hasShift,
}: {
  /** False when the owner's shift is closed: the helper cannot sell until the owner opens one. */
  hasShift: boolean
  products: Product[]
  taxBps: number
  methods: PaymentMethod[]
  qris: Qris
}) {
  const helper = useHelper()
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Line[]>([])
  const [picking, setPicking] = useState<Product>()
  const [soldOut, setSoldOut] = useState<string>()
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState<{ id: string; change: number }>()
  const [returning, setReturning] = useState(false)
  const methods = useMemo(() => helperMethods(allMethods), [allMethods])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
  }, [q, products])

  // pos-api prices the cart (unit and wholesale tier); a quote of an older cart is never used.
  const sig = cartSignature(cart)
  const [quote, setQuote] = useState<{ sig: string; quote: Quote }>()
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [quoteTry, setQuoteTry] = useState(0)
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
  const priced = priceEntries(cart, quote?.sig === sig ? quote.quote : null)
  const subtotal = subtotalOf(priced)
  const { tax, total } = breakdown({ subtotal, lineDiscount: 0, voucherDiscount: 0, taxBps })

  const add = (product: Product) => {
    if (stockState(product.stock, product.lowStockThreshold) === 'out') return setSoldOut(`${product.name} habis.`)
    setSoldOut(undefined)
    if (needsUnitPicker(product)) setPicking(product)
    else setCart((c) => addEntry(c, product, null, 1))
  }
  const setQty = (key: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => entryKey(l) !== key) : c.map((l) => (entryKey(l) === key ? { ...l, qty } : l))))
  const ends = endsAtText(helper?.expiresAt)

  return (
    <main className="grid min-h-svh bg-default-secondary md:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <section aria-label="Produk" className="min-w-0 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-0">
            <Text as="h1" variant="h5" weight="bold" className="truncate">
              {helperTitle(helper?.name)}
            </Text>
            <p className="text-xs text-default-secondary">
              Hanya untuk berjualan{ends ? `, berakhir pukul ${ends}` : ''}.
            </p>
          </div>
          <GuideButton />
          <Button width="auto" type="outline" size="small" onClick={() => setReturning(true)} data-guide="helper-return">
            Kembali ke pemilik
          </Button>
          <div className="w-full sm:w-72">
            <TextField
              aria-label="Cari produk"
              type="search"
              size="small"
              leadingAdornment={<Icon name="search" size="sm" />}
              placeholder="Ketik nama atau kode…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {soldOut && <ErrorText>{soldOut}</ErrorText>}
        {!hasShift ? (
          <Card>
            <Empty
              title="Shift belum dibuka"
              hint="Penjualan pembantu masuk ke shift pemilik. Kembali ke pemilik untuk membuka shift."
            />
          </Card>
        ) : products.length === 0 ? (
          <Card>
            <Empty title="Belum ada produk aktif" hint="Minta pemilik menambahkan produk di Katalog." />
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <Empty title="Produk tidak ditemukan" hint="Coba kata lain." />
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-guide="helper-products">
            {shown.map((p) => {
              const state = stockState(p.stock, p.lowStockThreshold)
              const inCart = baseQtyInCart(cart, p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    aria-label={`Tambah ${p.name}`}
                    className={`flex h-full min-h-28 w-full flex-col gap-1 rounded-2xl border border-default-primary bg-default-primary p-3 text-left transition active:scale-[0.98] hover:border-default-brand${state === 'out' ? ' opacity-55' : ''}`}
                  >
                    <span className="text-sm text-default-brand">{rupiah(p.sellingPrice)}</span>
                    <span className="line-clamp-2 font-semibold text-default-primary">{p.name}</span>
                    <span className="mt-auto flex items-center justify-between pt-2 text-xs text-default-secondary">
                      {state === 'out' ? (
                        <Badge color="danger" size="small">
                          Habis
                        </Badge>
                      ) : (
                        <span>{p.category.name}</span>
                      )}
                      {inCart > 0 && <Badge size="small">{inCart}</Badge>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <aside
        aria-label="Pesanan"
        data-guide="helper-cart"
        className="flex min-w-0 flex-col gap-3 border-default-primary bg-default-primary p-4 md:sticky md:top-0 md:h-svh md:border-l"
      >
        <div className="flex items-center justify-between">
          <Text as="h2" variant="h6" weight="bold">
            Pesanan
          </Text>
          {cart.length > 0 && (
            <Button width="auto" type="text" size="compact" color="danger" onClick={() => setCart([])}>
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
                return (
                  <li key={key} className="rounded-2xl border border-default-primary p-3">
                    <p className="flex justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{name}</span>
                      <span className="shrink-0 text-default-brand">{rupiah(pl.lineTotal)}</span>
                    </p>
                    <p className="mt-1 text-xs text-default-secondary">
                      {l.qty} {unitLabel(l.product, l.unit)} × {rupiah(pl.unitPrice)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button iconOnly aria-label={`Tambah ${name}`} size="small" onClick={() => setQty(key, l.qty + 1)}>
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
                      <Button iconOnly aria-label={`Hapus ${name}`} size="small" type="ghost" color="danger" onClick={() => setQty(key, 0)}>
                        <Icon name="trash" size="sm" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <dl className="space-y-2 rounded-2xl border border-default-primary p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-default-secondary">{quoteState === 'loading' ? 'Subtotal (menghitung…)' : 'Subtotal'}</dt>
            <dd>{rupiah(subtotal)}</dd>
          </div>
          {taxBps > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-default-secondary">Pajak {taxBps / 100}%</dt>
              <dd>{rupiah(tax)}</dd>
            </div>
          )}
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
            Harga belum bisa dicek ke server. Coba lagi sebelum menerima pembayaran.
          </Alert>
        )}
        <Button
          size="large"
          width="full"
          disabled={!hasShift || cart.length === 0 || quoteState !== 'idle' || methods.length === 0}
          onClick={() => setPaying(true)}
          data-guide="helper-pay"
        >
          Bayar
        </Button>
        {methods.length === 0 && (
          <p className="text-xs text-default-secondary">Belum ada cara bayar tunai, debit, atau QRIS. Minta pemilik mengaturnya.</p>
        )}
      </aside>

      <UnitPicker
        product={picking}
        onClose={() => setPicking(undefined)}
        onAdd={(product, unit, qty) => {
          setCart((c) => addEntry(c, product, unit, qty))
          setPicking(undefined)
        }}
      />
      {paying && (
        <HelperPayDialog
          cart={cart}
          total={total}
          methods={methods}
          qris={qris}
          onClose={() => setPaying(false)}
          onPaid={(sale) => {
            setPaying(false)
            setCart([])
            setDone(sale)
          }}
        />
      )}
      <HelperDoneDialog sale={done} onClose={() => setDone(undefined)} />
      <ReturnDialog open={returning} onClose={() => setReturning(false)} />
    </main>
  )
}

/** Cash, debit or the store's static QRIS; the sale is sent once per order (one Idempotency-Key until it is paid). */
function HelperPayDialog({
  cart,
  total,
  methods,
  qris,
  onClose,
  onPaid,
}: {
  cart: Line[]
  total: number
  methods: PaymentMethod[]
  qris: Qris
  onClose: () => void
  onPaid: (sale: { id: string; change: number }) => void
}) {
  const router = useRouter()
  const [methodId, setMethodId] = useState(() => methods.find((m) => m.kind === 'cash')?.id ?? methods[0]?.id ?? '')
  const method = methods.find((m) => m.id === methodId)
  const [paidText, setPaidText] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [qrisBroken, setQrisBroken] = useState(false)
  const lock = useRef(false)
  // One key for this order: a retry after no answer is the same sale, never a second one.
  const key = useRef<string>(crypto.randomUUID())
  const sentFor = useRef<string | null>(null)
  const isCash = method?.kind === 'cash'
  const payable = total + (isCash ? cashRounding(total) : 0)

  async function pay() {
    if (lock.current) return
    const checked = helperPaid(method?.kind, total, paidText)
    if ('error' in checked) return setError(checked.error)
    // Another method or amount is another request body: a new key, or pos-api would answer the first one's sale.
    const body = JSON.stringify([methodId, checked.amount])
    if (sentFor.current !== null && sentFor.current !== body) key.current = crypto.randomUUID()
    sentFor.current = body
    lock.current = true
    setBusy(true)
    setError(undefined)
    const res = await createSale({
      data: { key: key.current, lines: requestLines(cart), paid: checked.amount, paymentMethodId: methodId || undefined },
    }).catch(() => ({ ok: false as const, status: 0, error: NO_ANSWER }))
    lock.current = false
    setBusy(false)
    if (!res.ok) {
      showError(res, {
        action: 'menyimpan penjualan',
        // no answer, or the payment service did not answer: the same key, so it is never a second sale
        retry: res.status === 0 || res.status === 503 ? () => void pay() : undefined,
      })
      if ('total' in res && typeof res.total === 'number' && res.total !== total) void router.invalidate()
      return setError(res.error)
    }
    notifySuccess('Pembayaran berhasil')
    void router.invalidate() // stock changed
    onPaid({ id: res.data.id, change: Math.max(res.data.change, 0) })
  }

  const change = isCash && paidText.trim() ? helperPaid('cash', total, paidText) : null
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()} size="small" centered label="Pembayaran" closeDisabled={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void pay()
        }}
        className="flex max-h-[88dvh] flex-col gap-4 overflow-y-auto px-6 pt-6 pb-6"
      >
        <SegmentedControl
          aria-label="Metode pembayaran"
          className="flex max-w-full flex-wrap rounded-ds-xl"
          options={methods.map((m) => ({ value: m.id, label: m.name }))}
          value={methodId}
          onChange={(v) => {
            setMethodId(v)
            setError(undefined)
          }}
        />
        <p className="flex justify-between text-base font-bold">
          <span>{isCash && payable !== total ? 'Harus dibayar' : 'Total'}</span>
          <span className="text-default-brand">{rupiah(payable)}</span>
        </p>
        {isStaticQris(method?.kind) && (
          <div className="space-y-3 text-center" aria-label="QRIS toko">
            {qris.configured && !qrisBroken ? (
              <img
                src={qrisSrc(qris.version)}
                alt="Kode QRIS toko"
                onError={() => setQrisBroken(true)}
                className="mx-auto size-56 rounded-lg bg-white object-contain"
              />
            ) : (
              <Alert variant="warning" size="small">
                {qrisBroken ? QRIS_LOAD_ERROR : 'QRIS toko belum diatur. Minta pemilik mengunggahnya, atau pilih cara bayar lain.'}
              </Alert>
            )}
            <p className="text-sm text-default-secondary">{qrisScanHint(rupiah(total))}</p>
            <Alert variant="warning" size="small">
              {QRIS_NO_BANK_CHECK}
            </Alert>
          </div>
        )}
        {isCash && (
          <>
            <TextField
              label="Uang diterima"
              prefix="Rp"
              inputMode="numeric"
              value={paidText}
              onChange={(e) => {
                setPaidText(e.target.value)
                setError(undefined)
              }}
              placeholder="0"
              autoFocus
            />
            <div className="grid grid-cols-3 gap-2" aria-label="Nominal cepat">
              {quickAmounts(payable).map((n) => (
                <Button width="auto" key={n} type="outline" color="light" disabled={busy} onClick={() => setPaidText(String(n))}>
                  {n === payable ? 'Uang pas' : rupiah(n)}
                </Button>
              ))}
            </div>
            {change && 'amount' in change && (
              <p className="flex justify-between text-sm">
                <span className="text-default-secondary">Kembalian</span>
                <span className="font-bold text-default-success">{rupiah(change.amount - payable)}</span>
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-default-error">
            {error}
          </p>
        )}
        <ActionRow>
          <Button width="auto" type="outline" color="light" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button width="auto" htmlType="submit" isLoading={busy} disabled={!method}>
            {confirmButtonLabel(method?.kind)}
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}

function HelperDoneDialog({ sale, onClose }: { sale?: { id: string; change: number }; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()} centered size="small" label="Pembayaran berhasil">
      <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-6 text-center">
        <span className="text-default-success">
          <Icon name="check-circle" size="xl" />
        </span>
        <p className="text-default-secondary">Berhasil</p>
        <Text variant="h4" weight="bold">
          Kembalian: {rupiah(sale?.change ?? 0)}
        </Text>
        <ActionRow className="mt-4 w-full">
          <Button width="auto" type="outline" color="light" onClick={onClose}>
            Tutup
          </Button>
          <Button width="auto" onClick={() => sale && void navigate({ to: '/kasir/struk/$id', params: { id: sale.id } })}>
            Cetak struk
          </Button>
        </ActionRow>
      </div>
    </Dialog>
  )
}

/** "Kembali ke pemilik": the owner's PIN ends the handover and this device holds the owner's session again. */
function ReturnDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const bad = pinInputError(pin)
    if (bad) return setError(bad)
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const res = await endHelper({ data: { pin } }).catch(() => ({ ok: false as const, status: 0, error: NO_ANSWER }))
    lock.current = false
    setBusy(false)
    setPin('')
    if (!res.ok) {
      const failure = pinFailure(res)
      return showError(failure, { action: 'membuka sesi pemilik' })
    }
    onClose()
    switchSessionAndReload(RETURN_TOAST) // the owner's till loads afresh, and every other tab of this browser reloads
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} title="Kembali ke pemilik" size="small" centered>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <p className="text-sm text-default-secondary">Pemilik memasukkan PIN untuk membuka sesinya lagi di perangkat ini.</p>
        <TextField
          label="PIN pemilik"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(pinDigits(e.target.value))
            setError(undefined)
          }}
          error={error}
          autoFocus
        />
        <ActionRow>
          <Button width="auto" type="outline" color="light" size="small" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button width="auto" htmlType="submit" size="small" isLoading={busy}>
            Buka sesi pemilik
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}
