import { Alert, Button, Dialog, Select, TextField } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/page'
import { notifySuccess, showError } from '@/lib/feedback'
import { ApproverPinFields, ApproverStatus, useApprovers } from './-approver-fields'
import { voidSale, type SaleVoid } from './-void-api'
import { refundSale } from './-online-api'
import { useLost } from './-use-lost'
import {
  NOTE_MAX,
  VOID_REASONS,
  failureOf,
  isWrongPin,
  keepsPin,
  refundGuidance,
  voidBody,
  voidFormErrors,
  type MethodKind,
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
  /** UMK-1991: the sale was paid through a payment gateway (QRIS, VA): it is refunded, never voided. */
  online?: boolean
}

/**
 * "Batalkan transaksi" (UMK-1962): reason, the admin who approves and their 6-digit PIN. The cashier starts it; the
 * approver types the PIN on the same device. The PIN lives only in this component's state: it is cleared after every
 * submit and when the dialog closes, never put in a URL, storage or log.
 */
export function VoidDialog({ open, onClose, onChanged, sale, methodKind, online = false }: Props) {
  const lost = useLost()
  const what = online ? 'refund struk' : 'membatalkan struk'
  const { approvers, reload: fetchApprovers, list, anyApprover } = useApprovers(open)
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const [approverId, setApproverId] = useState('')
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<VoidFormErrors>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false) // a double submit arrives before `busy` re-renders
  // One key per attempt (per opening): a retry after a lost answer replays the first result, never voids twice.
  const key = useRef('')

  useEffect(() => {
    if (!open) return
    key.current = crypto.randomUUID()
    setReasonCode('')
    setNote('')
    setApproverId('')
    setPin('')
    setErrors({})
  }, [open])

  const guidance = refundGuidance(online ? 'online' : methodKind, sale.amountDue, rupiah)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const form = { reasonCode, note, approverId, pin }
    const bad = voidFormErrors(form)
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const input = { saleId: sale.id, key: key.current, ...voidBody(form) }
    // A paid QRIS or VA sale goes through the refund route; the answer has the void's own failure kinds either way.
    const answer = await (online ? refundSale({ data: input }) : voidSale({ data: input })).catch(lost)
    // Cleared after a submit, except for a refusal that is not about the PIN (the admin should not type it again).
    if (!answer || answer.ok || !keepsPin(answer.failure)) setPin('')
    lock.current = false
    setBusy(false)
    if (!answer) {
      showError({ status: 0 }, what)
      return
    }
    if (answer.ok) {
      notifySuccess(
        online
          ? `Refund ${rupiah(sale.amountDue)} diminta. Struk #${sale.number} dibatalkan`
          : `Struk #${sale.number} dibatalkan`,
      )
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
    }
    // Every refusal is also explained in the error dialog, so none is silent (the field message stays as well).
    const code = 'code' in answer ? answer.code : undefined
    showError(code ? { ...failureOf(f), code } : failureOf(f), what)
    // A lock or a PIN count changed: show who can still approve.
    if (f.kind === 'locked' || isWrongPin(f)) fetchApprovers()
    if (f.kind === 'done') onChanged(null)
  }

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
      title={online ? `Refund struk #${sale.number}?` : `Batalkan transaksi #${sale.number}?`}
      size="small"
      centered
    >
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">
          {online
            ? 'Refund hanya penuh dan hanya sekali. Penjualan dibatalkan dan stok serta voucher kembali sekarang; struk tetap ada dengan tanda VOID. Dana kembali ke pelanggan saat gateway memastikan.'
            : 'Seluruh struk dibatalkan dan tidak bisa dikembalikan atau dibatalkan sebagian. Stok dan voucher kembali, struk tetap ada dengan tanda VOID.'}
        </p>
        <Alert variant="info" size="small">
          {guidance.text}
        </Alert>

        <ApproverStatus approvers={approvers} anyApprover={anyApprover} reload={fetchApprovers} />

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
        <ApproverPinFields
          approvers={approvers}
          list={list}
          approverId={approverId}
          pin={pin}
          errors={errors}
          onApprover={(v) => {
            setApproverId(v)
            setErrors((x) => ({ ...x, approverId: undefined }))
          }}
          onPin={(v) => {
            setPin(v)
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
        />

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
            {online ? `Refund ${rupiah(sale.amountDue)}` : 'Batalkan transaksi'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
