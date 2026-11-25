import { Alert, Button, Dialog, Select, Spinner, TextField, toast } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/page'
import { loadApprovers, voidSale, type SaleVoid } from './-void-api'
import {
  NOTE_MAX,
  VOID_REASONS,
  approverOptions,
  isWrongPin,
  pinDigits,
  refundGuidance,
  voidBody,
  voidFormErrors,
  type Approver,
  type MethodKind,
  type VoidFailure,
  type VoidFormErrors,
} from './-void-helpers'

type Props = {
  open: boolean
  onClose: () => void
  /** Called after a successful void or when the server says the sale is already void: the page reloads. */
  onChanged: (saleVoid: SaleVoid | null) => void
  /** `amountDue` is what was taken in (total plus cash rounding), which is what goes back. */
  sale: { id: string; number: number; amountDue: number }
  methodKind: MethodKind | null
}

type Approvers = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; list: Approver[] }

/**
 * "Batalkan transaksi" (UMK-1962): reason, the admin who approves and their 6-digit PIN. The cashier starts it; the
 * approver types the PIN on the same device. The PIN lives only in this component's state: it is cleared after every
 * submit and when the dialog closes, never put in a URL, storage or log.
 */
export function VoidDialog({ open, onClose, onChanged, sale, methodKind }: Props) {
  const [approvers, setApprovers] = useState<Approvers>({ state: 'loading' })
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const [approverId, setApproverId] = useState('')
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<VoidFormErrors>({})
  const [failure, setFailure] = useState<VoidFailure>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // a double submit arrives before `busy` re-renders
  // One key per attempt (per opening): a retry after a lost answer replays the first result, never voids twice.
  const key = useRef('')

  const fetchApprovers = () => {
    setApprovers({ state: 'loading' })
    loadApprovers().then(
      (r) => setApprovers(r.ok ? { state: 'ready', list: r.approvers } : { state: 'error', error: r.error }),
      () => setApprovers({ state: 'error', error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }),
    )
  }

  useEffect(() => {
    if (!open) return
    key.current = crypto.randomUUID()
    setReasonCode('')
    setNote('')
    setApproverId('')
    setPin('')
    setErrors({})
    setFailure(undefined)
    fetchApprovers()
  }, [open])

  const guidance = refundGuidance(methodKind, sale.amountDue, rupiah)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const form = { reasonCode, note, approverId, pin }
    const bad = voidFormErrors(form)
    setErrors(bad)
    setFailure(undefined)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const answer = await voidSale({ data: { saleId: sale.id, key: key.current, ...voidBody(form) } }).catch(
      () => null,
    )
    setPin('') // cleared after every submit, whatever the answer
    lock.current = false
    setBusy(false)
    if (!answer) {
      setFailure({ kind: 'offline', error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.', errors: {} })
      return
    }
    if (answer.ok) {
      toast(`Struk #${sale.number} dibatalkan`, { variant: 'success' })
      onChanged(answer.saleVoid)
      onClose()
      return
    }
    const f = answer.failure
    if (isWrongPin(f)) setErrors({ pin: 'PIN salah. Periksa PIN lalu coba lagi.' })
    else {
      const field: VoidFormErrors = {}
      if (f.errors.note) field.note = f.errors.note
      if (f.errors.reasonCode) field.reasonCode = f.errors.reasonCode
      if (f.errors.approverId) field.approverId = f.errors.approverId
      setErrors(field)
      // Everything not shown on a field is shown on top, so no refusal is silent.
      if (f.kind !== 'invalid' || Object.keys(field).length === 0 || f.errors._) setFailure(f)
    }
    // A lock or a PIN count changed: show who can still approve.
    if (f.kind === 'locked' || isWrongPin(f)) fetchApprovers()
    if (f.kind === 'done') onChanged(null)
  }

  const list = approvers.state === 'ready' ? approvers.list : []
  const anyApprover = list.some((a) => a.hasPin)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        if (!o) {
          setPin('')
          onClose()
        }
      }}
      title={`Batalkan transaksi #${sale.number}?`}
      size="small"
      centered
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-6 pb-6">
        <p className="text-sm text-default-secondary">
          Seluruh struk dibatalkan dan tidak bisa dikembalikan atau dibatalkan sebagian. Stok dan voucher kembali, struk
          tetap ada dengan tanda VOID.
        </p>
        <Alert variant="info" size="small">
          {guidance.text}
        </Alert>

        {approvers.state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-default-secondary" role="status">
            <Spinner /> Memuat daftar admin…
          </div>
        )}
        {approvers.state === 'error' && (
          <Alert
            variant="danger"
            size="small"
            role="alert"
            action={
              <Button type="outline" color="light" size="small" width="auto" onClick={fetchApprovers}>
                Coba lagi
              </Button>
            }
          >
            {approvers.error}
          </Alert>
        )}
        {approvers.state === 'ready' && !anyApprover && (
          <Alert variant="warning" size="small" role="alert">
            Belum ada pemilik atau admin dengan PIN pembatalan. Minta pemilik membuat PIN di menu Keamanan sebelum ada
            struk yang bisa dibatalkan.
          </Alert>
        )}

        <Select
          label="Alasan (wajib, pilih satu)"
          options={VOID_REASONS.map((r) => ({ value: r.code, label: r.label }))}
          value={reasonCode}
          onValueChange={(v) => {
            setReasonCode(v)
            setErrors((x) => ({ ...x, reasonCode: undefined, note: undefined }))
          }}
          placeholder="Pilih alasan"
          error={errors.reasonCode}
        />
        <TextField
          label={reasonCode === 'other' ? 'Catatan (wajib)' : 'Catatan (boleh kosong)'}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => {
            setNote(e.target.value)
            setErrors((x) => ({ ...x, note: undefined }))
          }}
          error={errors.note}
        />
        <Select
          label="Admin yang menyetujui"
          options={approverOptions(list)}
          value={approverId}
          onValueChange={(v) => {
            setApproverId(v)
            setErrors((x) => ({ ...x, approverId: undefined }))
          }}
          placeholder="Pilih pemilik atau admin"
          emptyMessage="Belum ada admin"
          disabled={approvers.state !== 'ready'}
          error={errors.approverId}
        />
        <TextField
          label="PIN admin (6 angka)"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(pinDigits(e.target.value))
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
          error={errors.pin}
        />
        <p className="-mt-2 text-xs text-default-secondary">
          Minta admin mengetik PIN di perangkat ini. PIN tidak ditampilkan dan tidak disimpan. Salah 5 kali mengunci
          admin itu 5 menit.
        </p>

        {failure && (
          <Alert variant={failure.kind === 'done' ? 'warning' : 'danger'} size="small" role="alert">
            {failure.error}
            {failure.kind === 'locked' && failure.retryAfter
              ? ` Coba lagi sekitar ${Math.ceil(failure.retryAfter / 60)} menit lagi.`
              : ''}
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="outline"
            color="light"
            width="auto"
            disabled={busy}
            onClick={() => {
              setPin('')
              onClose()
            }}
          >
            Batal
          </Button>
          <Button
            type="primary"
            color="danger"
            width="auto"
            htmlType="submit"
            isLoading={busy}
            disabled={approvers.state !== 'ready' || !anyApprover}
          >
            Batalkan transaksi
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
