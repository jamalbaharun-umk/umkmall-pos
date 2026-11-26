import { Alert, Button, Dialog } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/page'
import { notifySuccess, showError } from '@/lib/feedback'
import { ApproverStatus, PinField, useApprovers } from './-approver-fields'
import { retryRefund } from './-online-api'
import { useLost } from './-use-lost'
import type { SaleVoid } from './-void-api'
import { approverBlock, failureOf, isWrongPin, keepsPin, retryBody, retryFormErrors, type VoidFormErrors } from './-void-helpers'

type Props = {
  open: boolean
  onClose: () => void
  /** The refund was asked again (or the server says it already moved): the page reads the refund again. */
  onChanged: () => void
  sale: { id: string; number: number; amount: number }
}

/**
 * "Coba lagi" of a refused refund (UMK-2040): the owner's alone, approved by an admin's 6-digit PIN with the void's
 * lockout. The PIN lives only in this component's state: cleared after every submit that did not keep it and when the
 * dialog closes; never in a URL, storage or log.
 */
export function RetryRefundDialog({ open, onClose, onChanged, sale }: Props) {
  const lost = useLost()
  const { approvers, reload, list } = useApprovers(open)
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<VoidFormErrors>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  // The PIN a refusal kept (`keepsPin`) must not outlive the dialog: closed by the parent or unmounted, it is gone.
  useEffect(() => {
    if (!open) setPin('')
    return () => setPin('')
  }, [open])

  useEffect(() => {
    if (!open) return
    setPin('')
    setErrors({})
  }, [open])

  // UMK-2040 (owner decision): only the store owner's own PIN approves a retry, so the approver is the owner, never a pick.
  const owner = list.find((a) => a.kind === 'owner')
  const ownerBlock = owner ? approverBlock(owner) : 'Belum ada PIN pembatalan pemilik'
  const approverId = owner?.id ?? ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const form = { approverId, pin }
    const bad = retryFormErrors(form)
    if (bad.approverId) bad.pin = ownerBlock ?? 'PIN pemilik belum tersedia'
    delete bad.approverId
    setErrors(bad)
    if (Object.keys(bad).length > 0) return
    lock.current = true
    setBusy(true)
    const answer = await retryRefund({ data: { saleId: sale.id, ...retryBody(form) } }).catch(lost)
    if (!answer || answer.ok || !keepsPin(answer.failure)) setPin('')
    lock.current = false
    setBusy(false)
    if (!answer) return showError({ status: 0 }, { action: 'mengajukan refund lagi' })
    if (answer.ok) {
      notifySuccess(`Refund ${rupiah(sale.amount)} diminta lagi ke gateway`)
      onChanged()
      onClose()
      return
    }
    const f = answer.failure
    if (isWrongPin(f)) setErrors({ pin: 'PIN salah. Periksa PIN pemilik lalu coba lagi.' })
    // Every refusal is also explained in the error dialog: a wrong PIN, a lock (with the wait), a 403, a 409.
    showError(answer.code ? { ...failureOf(f), code: answer.code } : failureOf(f), 'mengajukan refund lagi')
    // A lock or a PIN count changed: show who can still approve.
    if (f.kind === 'locked' || isWrongPin(f)) reload()
    if (f.kind === 'done') onChanged()
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
      title={`Coba lagi refund struk #${sale.number}?`}
      size="small"
      centered
    >
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <p className="text-sm text-default-secondary">
          Refund {rupiah(sale.amount)} diminta lagi ke gateway dengan alasan dan catatan yang sama. Ini hanya bisa
          dilakukan pemilik dan perlu PIN pemilik. Dana kembali ke pelanggan saat gateway memastikan.
        </p>
        <Alert variant="info" size="small">
          Bila uang sudah Anda kembalikan di luar gateway, jangan coba lagi: tandai refund ini dikembalikan manual.
        </Alert>
        {approvers.state !== 'ready' && <ApproverStatus approvers={approvers} anyApprover reload={reload} />}
        {ownerBlock && approvers.state === 'ready' && (
          <Alert variant="warning" size="small" role="alert">
            {ownerBlock}.{owner?.hasPin ? '' : ' Buat PIN pembatalan di menu Keamanan.'}
          </Alert>
        )}
        <PinField
          label="PIN pemilik (6 angka)"
          pin={pin}
          error={errors.pin}
          onPin={(v) => {
            setPin(v)
            setErrors((x) => ({ ...x, pin: undefined }))
          }}
        />
        <p className="-mt-2 text-xs text-default-secondary">
          PIN tidak ditampilkan dan tidak disimpan. Salah 5 kali mengunci PIN pemilik 5 menit.
        </p>
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
            disabled={approvers.state !== 'ready' || ownerBlock !== null}
          >
            Coba lagi refund
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
