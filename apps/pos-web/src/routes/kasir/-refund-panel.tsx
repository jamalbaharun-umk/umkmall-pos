import { useRouter } from '@tanstack/react-router'
import { Alert, Badge, Button, Dialog, TextField } from '@umkmall/ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/pos-page'
import { useIsOwner } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { markRefundManual } from './-online-api'
import { RetryRefundDialog } from './-retry-dialog'
import type { SaleVoid } from './-void-api'
import { useLost } from './-use-lost'
import { MANUAL_NOTE_MAX, manualNoteError, refundStateText } from './-void-helpers'

/**
 * Where the refund of a paid QRIS or VA sale stands (UMK-1991): pending, succeeded or refused, with the next step.
 * "Coba lagi" and "Dikembalikan manual" are the owner's alone (approved design 27), the second after the money went
 * back outside the system. "Coba lagi" asks the owner's own PIN (UMK-2040, `RetryRefundDialog`). Every action ends in a success toast or the error dialog.
 */
export function RefundPanel({ saleVoid, onChanged }: { saleVoid: SaleVoid; onChanged: () => void }) {
  // Design 27: only the owner retries or marks a refund returned by hand; others see the status.
  const owner = useIsOwner()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [marking, setMarking] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string>()
  const lock = useRef(false)
  const lost = useLost()
  const amount = saleVoid.total + saleVoid.rounding
  const state = refundStateText(saleVoid.refundStatus, rupiah(amount))
  // A pending refund is followed by asking pos-api again (its job settles it), so the status moves by itself.
  const pending = saleVoid.refundStatus === 'pending'
  useEffect(() => {
    if (!pending) return
    // The whole route is read again, so not every few seconds and not while the tab is hidden.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void router.invalidate()
    }, 10_000)
    return () => clearInterval(t)
  }, [pending, router])
  if (!state) return null

  async function mark(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const error = manualNoteError(note)
    setNoteError(error)
    if (error) return
    lock.current = true
    setBusy(true)
    const r = await markRefundManual({ data: { saleId: saleVoid.saleId, note: note.trim() } }).catch(lost)
    lock.current = false
    setBusy(false)
    if (!r || !r.ok) return showError(r?.failure ?? { status: 0 }, 'menandai refund dikembalikan manual')
    setMarking(false)
    setNote('')
    notifySuccess('Refund ditandai dikembalikan manual')
    onChanged()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Refund pembayaran online</span>
        <Badge color={state.color} size="small">
          {state.label}
        </Badge>
      </div>
      <Alert variant={state.color === 'danger' ? 'danger' : state.color === 'success' ? 'success' : 'info'} size="small" role="status">
        {state.body}
      </Alert>
      {saleVoid.refundStatus === 'failed' &&
        (owner ? (
          <div className="flex flex-wrap gap-2">
            <Button width="auto" size="small" isLoading={busy} disabled={busy} onClick={() => setRetrying(true)}>
              Coba lagi
            </Button>
            <Button width="auto" size="small" type="outline" color="light" disabled={busy} onClick={() => setMarking(true)}>
              Dikembalikan manual
            </Button>
          </div>
        ) : (
          <p className="text-sm text-default-secondary">Hanya pemilik yang bisa mencoba lagi atau menandai refund ini.</p>
        ))}
      <RetryRefundDialog
        open={retrying}
        onClose={() => setRetrying(false)}
        onChanged={onChanged}
        sale={{ id: saleVoid.saleId, number: saleVoid.saleNumber, amount }}
      />
      <Dialog
        open={marking}
        onOpenChange={(o) => !o && !busy && setMarking(false)}
        title="Tandai dikembalikan manual?"
        size="small"
        centered
      >
        <form noValidate onSubmit={mark} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          <p className="text-sm text-default-secondary">
            Struk #{saleVoid.saleNumber} · {rupiah(amount)}. Gunakan hanya bila uang sudah Anda kembalikan ke pelanggan di
            luar gateway, misalnya transfer langsung. Sistem menanyakan gateway dulu; bila refund ternyata sudah
            berhasil, statusnya mengikuti gateway.
          </p>
          <TextField
            label="Catatan (wajib)"
            value={note}
            maxLength={MANUAL_NOTE_MAX}
            onChange={(e) => {
              setNote(e.target.value)
              setNoteError(undefined)
            }}
            error={noteError}
            placeholder="mis. transfer BCA 25 Nov, bukti di WA"
          />
          <div className="flex justify-end gap-2">
            <Button type="outline" color="light" width="auto" disabled={busy} onClick={() => setMarking(false)}>
              Batal
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy}>
              Tandai selesai
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
