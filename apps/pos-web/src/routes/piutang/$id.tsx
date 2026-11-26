import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextField,
} from '@umkmall/ui'
import { useRef, useState, type FormEvent } from 'react'
import { loadReceivable, payReceivable } from '../pelanggan/-api'
import { parseRupiah } from '../pelanggan/-form'
import { formatDay, formatMomentDay, LoadError, Page, Pending, rupiah } from '../pelanggan/-ui'
import { notifySuccess, showError } from '@/lib/feedback'
import { useCan } from '@/components/shell'
import { cashRoute, cashRouteNotice, paymentPlace, restAfter } from '../kasir/-shift-helpers'
import { ActionRow } from '@/components/action-row'
import { CorrectionDialog } from './-correction-dialog'
import { correctionReasonLabel, paidFromBook, rowStatus, signedRupiah } from './-correction'

// Lakasir ViewReceivable: details, the sale's items, the payment history and the "add payment" action.
export const Route = createFileRoute('/piutang/$id')({
  loader: ({ params }) => loadReceivable({ data: params.id }),
  pendingComponent: Pending,
  errorComponent: LoadError,
  component: ReceivablePage,
})

function ReceivablePage() {
  const { receivable: r, methods, shift } = Route.useLoaderData()
  const canOpenShift = useCan('sales.create')
  // UMK-1971: a correction is for the owner and staff who may void (design feature 31).
  const canCorrect = useCan('sales.void')
  const [correcting, setCorrecting] = useState<(typeof r.payments)[number] | null>(null)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // set synchronously: a double click sends one request
  const [error, setError] = useState<string>()
  const [amountError, setAmountError] = useState<string>()
  // One key per opened dialog: a double tap or a network retry records one payment (pos-api Idempotency-Key).
  const [key, setKey] = useState(() => crypto.randomUUID())

  // Where a cash instalment lands (pos-api decides again): the open shift, "open a shift first", or outside a shift.
  const method = methods.find((m) => m.id === methodId)
  const route = cashRoute({ isCash: method?.kind === 'cash', hasOpenShift: !!shift, canOpenShift })
  const notice = cashRouteNotice(route, shift?.openedAt, (iso) =>
    new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }),
  )
  const amountValue = parseRupiah(amount)
  const showRestAfter = amount.trim() !== '' && !Number.isNaN(amountValue) && amountValue > 0 && amountValue <= r.rest

  function openDialog() {
    setKey(crypto.randomUUID())
    setAmount('')
    setError(undefined)
    setAmountError(undefined)
    setOpen(true)
  }

  /** Mirrors pos-api: required, whole rupiah, more than 0, at most the rest. */
  function checkAmount(raw: string): string | undefined {
    if (!raw.trim()) return 'Wajib diisi'
    const value = parseRupiah(raw)
    if (Number.isNaN(value)) return 'Harus bilangan bulat rupiah'
    if (value <= 0) return 'Harus lebih dari 0'
    if (value > r.rest) return `Pembayaran melebihi sisa piutang (${rupiah(r.rest)})`
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const problem = checkAmount(amount)
    setAmountError(problem)
    if (problem) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    try {
      const res = await payReceivable({
        data: { id: r.id, key, amount: parseRupiah(amount), paymentMethodId: methodId || undefined },
      })
      if (!res.ok) {
        setAmountError(res.errors?.amount)
        if (!res.errors?.amount) setError(res.errors?.paymentMethodId ?? res.error)
        showError(res, 'mencatat pembayaran piutang')
        return
      }
      // Fresh numbers first, then close and toast together: no moment showing the old balance.
      await router.invalidate()
      setOpen(false)
      notifySuccess(`Pembayaran ${rupiah(parseRupiah(amount))} tercatat`)
    } catch (e) {
      setError('Terjadi kesalahan. Coba lagi sebentar lagi.')
      showError(e, 'mencatat pembayaran piutang')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Page
      title={`Piutang ${r.memberName}`}
      crumbs={[{ label: 'Piutang', to: '/piutang' }, { label: 'Detail' }]}
      actions={
        <>
          <Button asChild type="outline" color="light" width="auto">
            <Link to="/piutang">Kembali</Link>
          </Button>
          {r.rest > 0 && (
            <Button width="auto" onClick={openDialog}>
              Tambah pembayaran
            </Button>
          )}
        </>
      }
    >
      <Card variant="outlined" padding="large" className="space-y-6">
        <dl className="grid max-w-md grid-cols-2 gap-y-1 text-sm">
          <dt className="font-medium">Pelanggan</dt>
          <dd className="text-right">{r.memberName}</dd>
          <dt className="font-medium">Penjualan</dt>
          <dd className="text-right">#{r.saleNumber}</dd>
          <dt className="font-medium">Tanggal</dt>
          <dd className="text-right">{formatMomentDay(r.createdAt)}</dd>
          <dt className="font-medium">Jatuh tempo</dt>
          <dd className="text-right">{formatDay(r.dueDate)}</dd>
          <dt className="font-medium">Total piutang</dt>
          <dd className="text-right">{rupiah(r.total)}</dd>
          <dt className="font-medium">Dibayar</dt>
          <dd className="text-right">{rupiah(paidFromBook(r.payments))}</dd>
          <dt className="font-bold">Sisa piutang</dt>
          <dd className="text-right font-bold">{rupiah(r.rest)}</dd>
          <dt className="font-medium">Status</dt>
          <dd className="text-right">
            {r.rest === 0 ? <Badge color="success">Lunas</Badge> : <Badge color="warning">Belum lunas</Badge>}
          </dd>
        </dl>

        <section className="space-y-2">
          <Text as="h2" variant="h5" weight="bold">
            Barang
          </Text>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell className="text-right">{rupiah(l.unitPrice)}</TableCell>
                  <TableCell className="text-right">{l.qty}</TableCell>
                  <TableCell className="text-right">{rupiah(l.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="space-y-2">
          <Text as="h2" variant="h5" weight="bold">
            Riwayat pembayaran
          </Text>
          {r.payments.length === 0 ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-default-secondary">Belum ada pembayaran.</p>
              {r.rest > 0 && (
                <ActionRow align="start">
                  <Button type="outline" color="light" width="auto" onClick={openDialog}>
                    Terima pembayaran
                  </Button>
                </ActionRow>
              )}
            </div>
          ) : (
            <>
              {/* Phone: one card per row, the design's "Riwayat pembayaran" list. */}
              <ul className="divide-y divide-default-primary rounded-xl border border-default-primary md:hidden">
                {r.payments.map((p) => {
                  const st = rowStatus(p.status ?? 'active')
                  return (
                    <li key={p.id} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`font-semibold tabular-nums ${p.status === 'reversed' ? 'text-default-secondary line-through' : 'text-default-primary'}`}>
                            {p.status === 'reversal' ? 'Pembalik ' : ''}
                            {signedRupiah(p.amount, rupiah)} · {p.paymentMethod.toLowerCase()}
                          </p>
                          <p className="text-xs text-default-secondary">
                            {formatMomentDay(p.createdAt)} · {p.actorName}
                            {p.status === 'reversal' && ` · ${correctionReasonLabel(p.reasonCode ?? null).toLowerCase()}`}
                          </p>
                        </div>
                        <Badge color={st.color}>{st.label}</Badge>
                      </div>
                      {canCorrect && p.correctable && (
                        <ActionRow align="start">
                          <Button type="outline" color="light" size="small" width="auto" onClick={() => setCorrecting(p)}>
                            Koreksi pembayaran {rupiah(p.amount)}
                          </Button>
                        </ActionRow>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Oleh</TableHead>
                      {canCorrect && <TableHead className="text-right">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.payments.map((p) => {
                      const place = paymentPlace(p)
                      const st = rowStatus(p.status ?? 'active')
                      const placeLabel =
                        p.status === 'reversal'
                          ? p.shiftId
                            ? 'Keluar dari laci shift'
                            : p.collectedOutsideShift
                              ? 'Keluar dari kas penagih'
                              : place.label
                          : place.label
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap">{formatMomentDay(p.createdAt)}</TableCell>
                          <TableCell>
                            <span className="block">
                              {p.status === 'reversal'
                                ? `Pembalik · ${correctionReasonLabel(p.reasonCode ?? null).toLowerCase()}`
                                : p.paymentMethod}
                            </span>
                            {p.shiftId ? (
                              <Link
                                to="/kasir/shift/$id"
                                params={{ id: p.shiftId }}
                                className="text-xs font-medium text-brand-primary hover:underline"
                              >
                                {placeLabel}
                              </Link>
                            ) : (
                              <span className={`text-xs ${place.tone === 'warning' ? 'text-default-warning' : 'text-default-secondary'}`}>
                                {placeLabel}
                              </span>
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right whitespace-nowrap tabular-nums ${p.status === 'reversed' ? 'text-default-secondary line-through' : ''}`}
                          >
                            {signedRupiah(p.amount, rupiah)}
                          </TableCell>
                          <TableCell>
                            <Badge color={st.color}>{st.label}</Badge>
                          </TableCell>
                          <TableCell>{p.actorName}</TableCell>
                          {canCorrect && (
                            <TableCell className="text-right">
                              {p.correctable && (
                                <Button type="outline" color="light" size="small" width="auto" onClick={() => setCorrecting(p)}>
                                  Koreksi
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>
      </Card>

      <CorrectionDialog
        receivable={r}
        payment={correcting}
        methods={methods}
        shift={shift}
        canOpenShift={canOpenShift}
        onClose={() => setCorrecting(null)}
        onChanged={() => router.invalidate()}
      />

      <Dialog open={open} onOpenChange={setOpen} centered title="Tambah pembayaran">
        <form onSubmit={submit} noValidate className="space-y-4 px-6 pb-6">
          <p className="text-sm text-default-secondary">Sisa piutang {rupiah(r.rest)}</p>
          <TextField
            label="Jumlah (Rp)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setAmountError(undefined)
            }}
            error={amountError}
            placeholder="Contoh: 2.500"
            required
          />
          <Select
            label="Metode pembayaran"
            options={methods.map((m) => ({ value: m.id, label: m.name }))}
            value={methodId}
            onValueChange={setMethodId}
          />
          {notice && (
            <Alert variant={route.kind === 'needs-shift' ? 'warning' : 'info'} size="small">
              {notice}
              {route.kind === 'needs-shift' && (
                <>
                  {' '}
                  <Link to="/kasir" className="font-medium underline">
                    Buka shift
                  </Link>
                </>
              )}
            </Alert>
          )}
          {showRestAfter && (
            <p className="flex justify-between text-sm text-default-secondary">
              <span>Sisa setelah bayar</span>
              <span className="font-semibold">{rupiah(restAfter(r.rest, amountValue))}</span>
            </p>
          )}
          {error && (
            <Alert variant="danger" size="small" role="alert">
              {error}
            </Alert>
          )}
          <ActionRow>
            <Button type="outline" color="light" width="auto" onClick={() => {
                setAmount(String(r.rest))
                setAmountError(undefined)
              }}>
              Lunasi
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy || route.kind === 'needs-shift'}>
              Simpan
            </Button>
          </ActionRow>
        </form>
      </Dialog>
    </Page>
  )
}
