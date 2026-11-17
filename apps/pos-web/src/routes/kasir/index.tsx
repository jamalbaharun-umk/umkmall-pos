import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  SegmentedControl,
  Tabs,
  TabsList,
  TabsTrigger,
  Text,
  TextField,
  toast,
} from '@umkmall/ui'
import { useMemo, useState } from 'react'
import { Empty, ErrorText, LoadError, Pending, rupiah } from '@/components/pos-page'
import { createSale, loadCashier, openShift, type MemberOption, type PaymentMethod, type Product } from './-api'
import { MemberRow, VoucherRow, type AppliedVoucher } from './-u7'
import { numpadEdit, parseRupiah, quickAmounts, taxOf } from './-money'

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
  const { shift, products, taxBps, methods } = Route.useLoaderData()
  return shift ? <Register products={products} taxBps={taxBps} methods={methods} /> : <OpenShift />
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
    const res = await openShift({ data: amount }).catch(() => ({
      ok: false as const,
      error: 'Gagal membuka shift, coba lagi.',
    }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    await router.invalidate()
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-default-secondary p-4">
      <Card className="w-full max-w-md" padding="large">
        <Text as="h1" variant="h4" weight="bold">
          Buka laci kas
        </Text>
        <p className="mt-1 text-sm text-default-secondary">Hitung uang di laci sebelum mulai berjualan.</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <TextField
            label="Uang awal di laci"
            prefix="Rp"
            inputMode="numeric"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="0"
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
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

type CartLine = { product: Product; qty: number }
const ALL = 'semua'

function Register({ products, taxBps, methods }: { products: Product[]; taxBps: number; methods: PaymentMethod[] }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState(ALL)
  const [cart, setCart] = useState<CartLine[]>([])
  const [note, setNote] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [paying, setPaying] = useState(false)
  const [paid, setPaid] = useState<{ id: string; change: number }>()
  const [member, setMember] = useState<MemberOption | null>(null)
  const [voucher, setVoucher] = useState<AppliedVoucher | null>(null)
  // One key per order: a double tap or a retry after a network error sends the same key, so one sale.
  const [key, setKey] = useState(() => crypto.randomUUID())

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

  const subtotal = cart.reduce((n, l) => n + l.product.sellingPrice * l.qty, 0)
  // Estimate shown to the cashier; pos-api computes the charged total the same way (tax after the voucher).
  const voucherDiscount = voucher?.discount ?? 0
  const tax = taxOf(subtotal - voucherDiscount, taxBps)
  const total = subtotal - voucherDiscount + tax
  const qtyOf = (id: string) => cart.find((l) => l.product.id === id)?.qty ?? 0

  const add = (product: Product) =>
    setCart((c) =>
      c.some((l) => l.product.id === product.id)
        ? c.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { product, qty: 1 }],
    )
  const setQty = (id: string, qty: number) =>
    setCart((c) =>
      qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l)),
    )

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
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  aria-label={`Tambah ${p.name}`}
                  className="flex h-full min-h-32 w-full flex-col gap-1 rounded-2xl border border-default-primary bg-default-primary p-3 text-left transition active:scale-[0.98] hover:border-default-brand"
                >
                  <span className="text-sm text-default-brand">{rupiah(p.sellingPrice)}</span>
                  <span className="line-clamp-2 font-semibold text-default-primary">{p.name}</span>
                  <span className="text-xs text-default-secondary">{p.category.name}</span>
                  <span className="mt-auto flex items-center justify-between pt-2">
                    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-default-brand text-default-invert">
                      <Icon name="plus" size="sm" />
                    </span>
                    {qtyOf(p.id) > 0 && <Badge size="small">{qtyOf(p.id)}</Badge>}
                  </span>
                </button>
              </li>
            ))}
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
            <Button width="auto" asChild type="text" size="compact">
              <Link to="/kasir/riwayat">Riwayat</Link>
            </Button>
            <Button width="auto" asChild type="text" size="compact" color="danger">
              <Link to="/kasir/tutup">Tutup shift</Link>
            </Button>
          </div>
        </div>
        <Text as="h2" variant="h6" weight="bold">
          Pesanan
        </Text>
        <div className="min-h-24 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 rounded-2xl border border-default-primary py-8 text-default-secondary">
              <Icon name="x" size="md" /> Belum ada item
            </div>
          ) : (
            <ul className="space-y-2">
              {cart.map((l) => (
                <li key={l.product.id} className="rounded-2xl border border-default-primary p-3">
                  <p className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{l.product.name}</span>
                    <span className="shrink-0 text-default-brand">{rupiah(l.product.sellingPrice * l.qty)}</span>
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      iconOnly
                      aria-label={`Tambah ${l.product.name}`}
                      size="small"
                      onClick={() => setQty(l.product.id, l.qty + 1)}
                    >
                      <Icon name="plus" size="sm" />
                    </Button>
                    <TextField
                      aria-label={`Jumlah ${l.product.name}`}
                      size="xsmall"
                      inputMode="numeric"
                      className="w-16"
                      value={String(l.qty)}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, ''))
                        if (n > 0) setQty(l.product.id, Math.min(n, 100_000))
                      }}
                    />
                    <Button
                      iconOnly
                      aria-label={`Kurangi ${l.product.name}`}
                      size="small"
                      type="outline"
                      color="light"
                      onClick={() => setQty(l.product.id, l.qty - 1)}
                    >
                      <Icon name="minus" size="sm" />
                    </Button>
                    <Button
                      iconOnly
                      aria-label={`Hapus ${l.product.name}`}
                      size="small"
                      type="ghost"
                      color="danger"
                      onClick={() => setQty(l.product.id, 0)}
                    >
                      <Icon name="trash" size="sm" />
                    </Button>
                  </div>
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
          <VoucherRow voucher={voucher} amount={subtotal} onChange={setVoucher} />
        </dl>

        <dl className="space-y-2 rounded-2xl border border-default-primary p-3 text-sm">
          <Row label="Subtotal" value={<span className="text-default-brand">{rupiah(subtotal)}</span>} />
          {voucher && <Row label="Voucher" value={<span className="text-default-brand">−{rupiah(voucherDiscount)}</span>} />}
          <Row label="Pajak" value={<span className="text-default-brand">{taxBps / 100}%</span>} />
          <div className="flex justify-between border-t border-default-primary pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="text-default-brand">{rupiah(total)}</dd>
          </div>
        </dl>
        <Button size="large" width="full" disabled={cart.length === 0} onClick={() => setPaying(true)}>
          Lanjut ke pembayaran
        </Button>
      </aside>

      <NoteDialog open={editingNote} note={note} onClose={() => setEditingNote(false)} onSave={setNote} />
      {paying && (
        <PayDialog
          subtotal={subtotal}
          taxBps={taxBps}
          tax={tax}
          total={total}
          cart={cart}
          note={note}
          idempotencyKey={key}
          methods={methods}
          member={member}
          voucher={voucher}
          onClose={() => setPaying(false)}
          onPaid={(sale) => {
            setPaying(false)
            setPaid(sale)
            setCart([])
            setNote('')
            setMember(null)
            setVoucher(null)
            setKey(crypto.randomUUID())
          }}
        />
      )}
      <SuccessDialog sale={paid} onClose={() => setPaid(undefined)} />
    </main>
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
  taxBps,
  tax,
  total,
  cart,
  note,
  idempotencyKey,
  methods,
  member,
  voucher,
  onClose,
  onPaid,
}: {
  subtotal: number
  taxBps: number
  tax: number
  total: number
  cart: CartLine[]
  note: string
  idempotencyKey: string
  methods: PaymentMethod[]
  member: MemberOption | null
  voucher: AppliedVoucher | null
  onClose: () => void
  onPaid: (sale: { id: string; change: number }) => void
}) {
  const [paidText, setPaidText] = useState('')
  const [methodId, setMethodId] = useState(() => methods.find((m) => m.kind === 'cash')?.id ?? methods[0]?.id ?? '')
  const method = methods.find((m) => m.id === methodId)
  // Kasbon: paid may be 0 and the rest becomes the member's receivable; debit/wallet: exactly the total.
  const isCredit = method?.kind === 'credit'
  const isExact = method?.kind === 'debit' || method?.kind === 'wallet'
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const paid = parseRupiah(paidText)
  const change = Number.isNaN(paid) ? null : paid - total

  async function pay(amount: number) {
    if (busy) return
    if (isCredit) {
      if (!member) return setError('Pilih member untuk kasbon.')
      if (!paidText.trim()) amount = 0 // no down payment
      if (Number.isNaN(amount) || amount >= total) return setError('Kasbon harus menyisakan sisa tagihan.')
    } else if (isExact) {
      amount = total
    } else if (Number.isNaN(amount) || amount < total) return setError('Uang yang dibayar kurang dari total.')
    setBusy(true)
    setError(undefined)
    const res = await createSale({
      data: {
        key: idempotencyKey,
        lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
        paid: amount,
        note: note || undefined,
        memberId: member?.id,
        voucherCode: voucher?.code,
        paymentMethodId: methodId || undefined,
      },
    }).catch(() => ({
      ok: false as const,
      error: 'Tidak bisa terhubung. Coba lagi: penjualan tidak akan tercatat dua kali.',
    }))
    setBusy(false)
    if (!res.ok) {
      toast(res.error, { variant: 'danger' })
      return setError(res.error)
    }
    onPaid({ id: res.data.id, change: Math.max(amount - total, 0) })
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
            <p className={`text-sm ${member ? 'text-default-secondary' : 'text-default-error'}`}>
              {member
                ? `Kasbon atas nama ${member.name}. Uang muka boleh 0; sisanya menjadi piutang.`
                : 'Pilih member untuk kasbon.'}
            </p>
          )}
          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={<span className="text-default-brand">{rupiah(subtotal)}</span>} />
            {voucher && (
              <Row label={`Voucher ${voucher.code}`} value={<span className="text-default-brand">−{rupiah(voucher.discount)}</span>} />
            )}
            <Row label={`Pajak ${taxBps / 100}%`} value={<span className="text-default-brand">{rupiah(tax)}</span>} />
            <div className="flex justify-between border-t border-default-primary pt-2 font-bold">
              <dt>Total</dt>
              <dd className="text-default-brand">{rupiah(total)}</dd>
            </div>
          </dl>
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
                ? rupiah(Math.max(total - (Number.isNaN(paid) ? 0 : paid), 0))
                : change === null
                  ? '—'
                  : change < 0
                    ? `Kurang ${rupiah(-change)}`
                    : rupiah(change)}
            </span>
          </p>
          <div className="grid grid-cols-3 gap-2" aria-label="Nominal cepat">
            {quickAmounts(total)
              .filter((n) => n !== total)
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
            type={paid === total ? 'primary' : 'outline'}
            color={paid === total ? 'primary' : 'light'}
            disabled={busy}
            onClick={() => setPaidText(String(total))}
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
          <ErrorText>{error}</ErrorText>
          <div className="grid grid-cols-2 gap-2">
            <Button
              width="auto"
              htmlType="submit"
              size="large"
              isLoading={busy}
              disabled={isCredit ? !member : !isExact && (change === null || change < 0)}
            >
              {isCredit ? 'Simpan kasbon' : 'Bayar'}
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

function SuccessDialog({ sale, onClose }: { sale?: { id: string; change: number }; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()} centered size="small" label="Pembayaran berhasil">
      <div className="flex flex-col items-center gap-2 px-6 pb-6 pt-8 text-center">
        <span className="text-default-success">
          <Icon name="check-circle" size="xl" />
        </span>
        <p className="text-default-secondary">Berhasil</p>
        <Text variant="h4" weight="bold">
          Kembalian: {rupiah(sale?.change ?? 0)}
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
