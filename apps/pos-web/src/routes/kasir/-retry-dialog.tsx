import { Alert, Button, Dialog } from '@umkmall/ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/page'
import { notifySuccess, showError } from '@/lib/feedback'
import { ApproverPinFields, ApproverStatus, useApprovers } from './-approver-fields'
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
  const { approvers, reload, list, anyApprover } = useApprovers(open)
  const [approverId, setApproverId] = useState('')
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
    setApproverId('')
    setPin('')
    setErrors({})
  }, [open])

  // The owner is the one at the till, so their own entry is the first choice (they can pick another admin).
  useEffect(() => {
    if (approvers.state !== 'ready') return
    setApproverId((cur) => cur || approvers.list.find((a) => a.kind === 'owner' && approverBlock(a) === null)?.id || '')
  }, [approvers])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    const form = { approverId, pin }
    const bad = retryFormErrors(form)
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
    if (isWrongPin(f)) setErrors({ pin: 'PIN salah. Periksa PIN lalu coba lagi.' })
    else if (f.errors.approverId) setErrors({ approverId: f.errors.approverId })
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
          dilakukan pemilik dan perlu PIN admin. Dana kembali ke pelanggan saat gateway memastikan.
        </p>
        <Alert variant="info" size="small">
          Bila uang sudah Anda kembalikan di luar gateway, jangan coba lagi: tandai refund ini dikembalikan manual.
        </Alert>
        <ApproverStatus approvers={approvers} anyApprover={anyApprover} reload={reload} />
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
            Coba lagi refund
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
