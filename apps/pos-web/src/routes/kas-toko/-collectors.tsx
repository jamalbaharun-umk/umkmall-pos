import { getRouteApi, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Button,
  Card,
  Chip,
  Dialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '@umkmall/ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Empty, rupiah } from '@/components/pos-page'
import { useCan, type Me } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { withCode } from '../kasir/-cash-helpers'
import { formatAmountInput, parseAmount } from '../pengeluaran/-helpers'
import { createDeposit } from './-deposit-api'
import {
  depositableCollectors,
  depositErrors,
  depositToast,
  FAILURE_ACTION,
  FIELD_CODES,
  heldLabel,
  outstandingAfterText,
  type CollectorCash,
} from './-deposit-helpers'

const root = getRouteApi('__root__')

// Per-collector cash held outside a shift and the form to receive a deposit (design feature 21). A kasbon taken by a
// collector lowers the customer's debt at once, but the cash counts as "dipegang penagih" until a deposit is received.

/** The per-collector outstanding list, with a "Terima setoran" shortcut per row for who may record deposits. */
export function CollectorsPanel({ collectors }: { collectors: CollectorCash[] }) {
  const canReceive = useCan('store_cash.manage')
  const [picked, setPicked] = useState<string>()
  return (
    <Card variant="outlined" padding="none" className="overflow-hidden">
      <div className="px-4 pt-4">
        <h2 className="text-base font-bold text-default-primary">Uang dipegang penagih</h2>
        <p className="text-sm text-default-secondary">
          Kasbon yang ditagih di luar shift mengurangi hutang pelanggan saat itu juga, tetapi uangnya tetap dipegang
          penagih sampai setorannya diterima.
        </p>
      </div>
      {collectors.length === 0 ? (
        <Empty
          title="Belum ada uang yang dipegang penagih"
          hint="Kasbon tunai yang ditagih di luar shift akan muncul di sini."
        />
      ) : (
        <>
          <ul className="divide-y divide-default-primary md:hidden">
            {collectors.map((c) => (
              <li key={c.collectorId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-default-primary">{c.collectorName}</p>
                  <p className="text-xs text-default-secondary">
                    Ditagih {rupiah(c.collected)} · disetor {rupiah(c.handedOver)}
                  </p>
                  <p className={`text-sm font-semibold ${c.outstanding > 0 ? 'text-default-warning' : 'text-default-secondary'}`}>
                    {heldLabel(c)}
                  </p>
                </div>
                {canReceive && c.collectorKind === 'cashier' && c.outstanding > 0 && (
                  <Button size="small" width="auto" type="outline" onClick={() => setPicked(c.collectorId)}>
                    Terima
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Penagih</TableHead>
                  <TableHead className="text-right">Ditagih di luar shift</TableHead>
                  <TableHead className="text-right">Sudah disetor</TableHead>
                  <TableHead className="text-right">Belum disetor</TableHead>
                  <TableHead>
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collectors.map((c) => (
                  <TableRow key={c.collectorId}>
                    <TableCell>{c.collectorName}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(c.collected)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(c.handedOver)}</TableCell>
                    <TableCell className="text-right tabular-nums">{heldLabel(c)}</TableCell>
                    <TableCell className="text-right">
                      {canReceive && c.collectorKind === 'cashier' && c.outstanding > 0 && (
                        <Button size="small" width="auto" type="outline" onClick={() => setPicked(c.collectorId)}>
                          Terima setoran
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {picked && <DepositDialog collectors={collectors} initialId={picked} onClose={() => setPicked(undefined)} />}
    </Card>
  )
}

/** The page action: opens the deposit form without a collector chosen. Hidden without `store_cash.manage`. */
export function ReceiveDepositButton({ collectors }: { collectors: CollectorCash[] }) {
  const canReceive = useCan('store_cash.manage')
  const [open, setOpen] = useState(false)
  if (!canReceive) return null
  return (
    <>
      <Button width="auto" onClick={() => setOpen(true)}>
        Terima setoran
      </Button>
      {open && <DepositDialog collectors={collectors} onClose={() => setOpen(false)} />}
    </>
  )
}

function DepositDialog({
  collectors,
  initialId,
  onClose,
}: {
  collectors: CollectorCash[]
  initialId?: string
  onClose: () => void
}) {
  const router = useRouter()
  const me = root.useLoaderData() as Me | null
  const options = depositableCollectors(collectors, me?.actor.id)
  const [collectorId, setCollectorId] = useState(options.some((c) => c.collectorId === initialId) ? (initialId ?? '') : '')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // set synchronously: a double tap sends one request
  // One key per attempt: a retry of the same form is one deposit; changing anything makes a new key.
  const [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => setKey(crypto.randomUUID()), [collectorId, amountText, note])

  const who = options.find((c) => c.collectorId === collectorId)
  const amount = parseAmount(amountText)
  const after = outstandingAfterText(amount, who)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (inFlight.current) return
    const local = depositErrors({ collectorId, amount }, options)
    setErrors(local)
    if (Object.keys(local).length) return
    inFlight.current = true
    setBusy(true)
    try {
      const res = await createDeposit({
        data: { key, body: { collectorId, amount, ...(note.trim() ? { note: note.trim() } : {}) } },
      }).catch(() => ({ ok: false as const, status: 0, error: '', errors: undefined }))
      if (res.ok) {
        notifySuccess(depositToast(res.data))
        await router.invalidate()
        onClose()
        return
      }
      setErrors(res.errors ?? {})
      // A refusal may mean what the collector holds changed meanwhile: reload the figures.
      if (res.status === 409 || res.status === 422) void router.invalidate()
      showError(withCode(res, FIELD_CODES), {
        action: FAILURE_ACTION,
        retry: () => void submit(),
        fallback: 'Setoran belum tercatat. Uang yang dipegang penagih tidak berubah.',
      })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()} title="Terima setoran" size="small" closeDisabled={busy} keyboardAware>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-6 pt-2 pb-6">
        {options.length === 0 ? (
          <Alert variant="info" size="small">
            Tidak ada penagih yang masih memegang uang. Setoran muncul di sini setelah ada kasbon tunai yang ditagih di luar
            shift.
          </Alert>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm text-default-secondary">Diserahkan oleh</legend>
              <div className="flex flex-wrap gap-2">
                {options.map((c) => (
                  <Chip
                    key={c.collectorId}
                    state={collectorId === c.collectorId ? 'active' : 'default'}
                    onClick={() => setCollectorId(c.collectorId)}
                  >
                    {c.collectorName} · {rupiah(c.outstanding)}
                  </Chip>
                ))}
              </div>
              {errors.collectorId && (
                <p role="alert" className="text-sm text-default-error">
                  {errors.collectorId}
                </p>
              )}
            </fieldset>
            <TextField
              label="Jumlah uang diterima"
              prefix="Rp"
              inputMode="numeric"
              size="large"
              required
              placeholder="0"
              value={amountText}
              error={errors.amount}
              onChange={(e) => setAmountText(formatAmountInput(e.target.value))}
            />
            {who && (
              <p className="-mt-2 text-xs text-default-secondary">
                Belum disetor {who.collectorName}: {rupiah(who.outstanding)}. Jumlah di atas itu ditolak.
              </p>
            )}
            <TextField
              label="Catatan (boleh kosong)"
              placeholder="mis. tagihan Rabu"
              maxLength={200}
              value={note}
              error={errors.note}
              onChange={(e) => setNote(e.target.value)}
            />
            <dl className="flex flex-col gap-1 rounded-lg bg-default-secondary p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-default-secondary">Diserahkan oleh</dt>
                <dd>{who ? who.collectorName : '–'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-default-secondary">Diterima oleh</dt>
                <dd>{me?.actor.name ?? 'Anda'} (Anda)</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-default-secondary">Masuk ke</dt>
                <dd>Kas toko</dd>
              </div>
            </dl>
            {after && (
              <Alert variant="info" size="small">
                {after}
              </Alert>
            )}
          </>
        )}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            {options.length === 0 ? 'Tutup' : 'Batal'}
          </Button>
          {options.length > 0 && (
            <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
              Terima setoran
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  )
}
