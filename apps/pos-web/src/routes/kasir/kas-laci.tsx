import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Badge,
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
import { Empty, formatDate, LoadError, Page, Pending, rupiah } from '@/components/pos-page'
import { notifySuccess, showError } from '@/lib/feedback'
import { formatAmountInput, parseAmount } from '../pengeluaran/-helpers'
import { createCashEntry, loadCashDrawer, type DrawerPage } from './-cash-api'
import { entryKindLabel } from './-shift-helpers'
import {
  cashFormErrors,
  cashToast,
  directionTitle,
  drawerPreview,
  failureAction,
  manualEntries,
  maxTakeOut,
  signedRupiah,
  withCode,
  type CashDirection,
} from './-cash-helpers'
import { ActionRow } from '@/components/action-row'

// Drawer cash in/out by hand (design feature 20): "Tambah uang" and "Ambil uang" for the open shift, and the shift's
// manual entries. Entry point: the "Kas laci" button on the Kasir screen. pos-api refuses a cash-out above the drawer.
export const Route = createFileRoute('/kasir/kas-laci')({
  loader: () => loadCashDrawer(),
  component: CashDrawerPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function CashDrawerPage() {
  const { shift, reasons, entries } = Route.useLoaderData()
  const [open, setOpen] = useState<CashDirection>()
  const rows = manualEntries(entries)
  return (
    <Page title="Kas laci" crumbs={[{ label: 'Kasir', to: '/kasir' }, { label: 'Kas laci' }]}>
      {!shift ? (
        <Card variant="outlined" padding="large">
          <Empty
            title="Belum ada shift yang terbuka"
            hint="Buka shift dulu agar uang yang ditambah atau diambil dari laci tercatat."
            action={
              <Button width="auto" asChild>
                <Link to="/kasir">Buka shift</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card variant="outlined" padding="large" className="flex flex-col gap-4">
            <div>
              <p className="text-sm text-default-secondary">Uang di laci menurut catatan</p>
              <p className="text-3xl font-bold text-default-primary tabular-nums">{rupiah(shift.expectedCash)}</p>
              <p className="text-sm text-default-secondary">Shift dibuka {formatDate(shift.openedAt)}</p>
            </div>
            <ActionRow align="start">
              <Button type="outline" onClick={() => setOpen('out')}>
                − Ambil uang
              </Button>
              <Button onClick={() => setOpen('in')}>+ Tambah uang</Button>
            </ActionRow>
            <p className="text-xs text-default-secondary">
              Belanja untuk toko, misalnya beli galon? Catat di Pengeluaran dengan sumber Laci; laci otomatis berkurang di
              sana. Penjualan tunai, kasbon tunai, dan pengeluaran dari laci ada di rincian tutup shift.
            </p>
          </Card>
          <Card variant="outlined" padding="none" className="overflow-hidden">
            <h2 className="px-4 pt-4 text-base font-bold text-default-primary">Shift ini</h2>
            {rows.length === 0 ? (
              <Empty
                title="Belum ada uang masuk atau keluar manual"
                hint="Tambah modal laci, setor ke bank, setoran penagih yang Anda terima, dan bayar pemasok dari laci akan muncul di sini."
              />
            ) : (
              <>
                <ul className="divide-y divide-default-primary md:hidden">
                  {rows.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-default-primary">{e.reasonLabel ?? entryKindLabel(e.kind)}</p>
                        <p className="text-xs text-default-secondary">{formatDate(e.createdAt)}</p>
                        {e.note && <p className="text-sm text-default-secondary">{e.note}</p>}
                      </div>
                      <span
                        className={`font-semibold whitespace-nowrap tabular-nums ${e.direction === 'in' ? 'text-default-success' : 'text-default-error'}`}
                      >
                        {signedRupiah(e.direction, e.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Waktu</TableHead>
                        <TableHead>Alasan</TableHead>
                        <TableHead>Jenis</TableHead>
                        <TableHead>Catatan</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>{formatDate(e.createdAt)}</TableCell>
                          <TableCell>{e.reasonLabel ?? entryKindLabel(e.kind)}</TableCell>
                          <TableCell>
                            <Badge color={e.direction === 'in' ? 'success' : 'warning'}>
                              {e.direction === 'in' ? 'Uang masuk' : 'Uang keluar'}
                            </Badge>
                          </TableCell>
                          <TableCell>{e.note ?? '–'}</TableCell>
                          <TableCell className="text-right tabular-nums">{signedRupiah(e.direction, e.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </Card>
          {open && (
            <CashEntryDialog
              key={open}
              direction={open}
              drawerCash={shift.expectedCash}
              reasons={reasons}
              onClose={() => setOpen(undefined)}
            />
          )}
        </>
      )}
    </Page>
  )
}

function CashEntryDialog({
  direction,
  drawerCash,
  reasons,
  onClose,
}: {
  direction: CashDirection
  drawerCash: number
  reasons: DrawerPage['reasons']
  onClose: () => void
}) {
  const router = useRouter()
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // set synchronously: a double tap sends one request
  // One key per attempt: a retry of the same form is one entry; changing anything makes a new key.
  const [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => setKey(crypto.randomUUID()), [amountText, reason, note])

  const out = direction === 'out'
  const amount = parseAmount(amountText)
  const options = reasons[direction]
  const noteRequired = options.find((r) => r.reason === reason)?.noteRequired ?? false
  const preview = drawerPreview(direction, amount, drawerCash)
  const overDrawer = out && amount > drawerCash

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (inFlight.current) return
    const local = cashFormErrors({ direction, amount, reason, note }, reasons, drawerCash)
    setErrors(local)
    if (Object.keys(local).length) return
    inFlight.current = true
    setBusy(true)
    try {
      const res = await createCashEntry({
        data: { key, body: { direction, amount, reason, ...(note.trim() ? { note: note.trim() } : {}) } },
      }).catch(() => ({ ok: false as const, status: 0, error: '', errors: undefined }))
      if (res.ok) {
        notifySuccess(cashToast(res.data))
        await router.invalidate()
        onClose()
        return
      }
      setErrors(res.errors ?? {})
      // A refusal may mean the drawer changed meanwhile: reload its figure so the limit shown is current.
      if (res.status === 409 || res.status === 422) void router.invalidate()
      showError(withCode(res), {
        action: failureAction(direction),
        retry: () => void submit(),
        fallback: 'Uang belum tercatat. Data di laci tidak berubah.',
      })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={directionTitle(direction)}
      size="small"
      closeDisabled={busy}
      keyboardAware
    >
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-6">
        <TextField
          label={out ? 'Jumlah yang diambil' : 'Jumlah yang ditambahkan'}
          aria-label={out ? 'Jumlah yang diambil dari laci, dalam rupiah' : 'Jumlah yang ditambahkan ke laci, dalam rupiah'}
          prefix="Rp"
          inputMode="numeric"
          size="large"
          autoFocus
          required
          placeholder="0"
          value={amountText}
          error={errors.amount}
          onChange={(e) => setAmountText(formatAmountInput(e.target.value))}
        />
        {out && <p className="-mt-2 text-xs text-default-secondary">Paling banyak {rupiah(maxTakeOut(drawerCash))} (uang di laci).</p>}
        {overDrawer ? (
          <Alert variant="danger" size="small" role="alert">
            {cashFormErrors({ direction, amount, reason: '', note: '' }, reasons, drawerCash).amount} Isi paling banyak{' '}
            {rupiah(maxTakeOut(drawerCash))}; jumlah sama dengan uang di laci boleh.
          </Alert>
        ) : (
          preview && (
            <Alert variant="info" size="small">
              {preview}
            </Alert>
          )
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-default-secondary">Untuk apa?</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((r) => (
              <Chip key={r.reason} state={reason === r.reason ? 'active' : 'default'} onClick={() => setReason(r.reason)}>
                {r.label}
              </Chip>
            ))}
          </div>
          {errors.reason && (
            <p role="alert" className="text-sm text-default-error">
              {errors.reason}
            </p>
          )}
        </fieldset>
        <TextField
          label={noteRequired ? 'Catatan (wajib bila Lainnya)' : 'Catatan (boleh kosong)'}
          placeholder={out ? 'mis. tukar uang receh' : 'mis. uang receh dari bank'}
          maxLength={200}
          value={note}
          error={errors.note}
          onChange={(e) => setNote(e.target.value)}
        />
        <ActionRow>
          <Button htmlType="button" type="outline" color="light" width="auto" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button htmlType="submit" width="auto" isLoading={busy} disabled={busy}>
            {out ? 'Catat uang keluar' : 'Catat uang masuk'}
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  )
}
