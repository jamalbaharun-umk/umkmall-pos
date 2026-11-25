import { Alert, Badge, Button, Dialog, TextField } from '@umkmall/ui'
import { useRef, useState, type FormEvent } from 'react'
import { rupiah } from '@/components/pos-page'
import { useCan, useIsOwner } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { markRefundManual, retryRefund } from './-online-api'
import type { SaleVoid } from './-void-api'
import { MANUAL_NOTE_MAX, manualNoteError, refundStateText } from './-void-helpers'

/**
 * Where the refund of a paid QRIS or VA sale stands (UMK-1991): pending, succeeded or refused, with the next step.
 * "Ajukan lagi" is for a holder of `sales.void` (no new PIN); "Tandai dikembalikan manual" is the owner's alone, after
 * the money went back outside the system. Every action ends in a success toast or the error dialog.
 */
export function RefundPanel({ saleVoid, onChanged }: { saleVoid: SaleVoid; onChanged: () => void }) {
  const canRetry = useCan('sales.void')
  const owner = useIsOwner()
  const [busy, setBusy] = useState(false)
  const [marking, setMarking] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string>()
  const lock = useRef(false)
  const state = refundStateText(saleVoid.refundStatus)
  if (!state) return null

  async function retry() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const r = await retryRefund({ data: saleVoid.saleId }).catch(() => null)
    lock.current = false
    setBusy(false)
    if (!r || !r.ok) return showError(r?.failure ?? { status: 0 }, { action: 'mengajukan refund lagi', retry: () => void retry() })
    notifySuccess('Refund diajukan lagi ke gateway')
    onChanged()
  }

  async function mark(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const error = manualNoteError(note)
    setNoteError(error)
    if (error) return
    lock.current = true
    setBusy(true)
    const r = await markRefundManual({ data: { saleId: saleVoid.saleId, note: note.trim() } }).catch(() => null)
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
      {saleVoid.refundStatus === 'failed' && (
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <Button width="auto" size="small" isLoading={busy} disabled={busy} onClick={() => void retry()}>
              Ajukan refund lagi
            </Button>
          )}
          {owner && (
            <Button width="auto" size="small" type="outline" color="light" disabled={busy} onClick={() => setMarking(true)}>
              Tandai dikembalikan manual
            </Button>
          )}
          {!canRetry && !owner && (
            <p className="text-sm text-default-secondary">Minta pemilik atau admin berizin pembatalan untuk mengajukannya lagi.</p>
          )}
        </div>
      )}
      <Dialog
        open={marking}
        onOpenChange={(o) => !o && !busy && setMarking(false)}
        title="Tandai dikembalikan manual?"
        size="small"
        centered
      >
        <form noValidate onSubmit={mark} className="flex flex-col gap-4 px-6 pb-6">
          <p className="text-sm text-default-secondary">
            Hanya tandai setelah Anda benar-benar mengembalikan {rupiah(saleVoid.total + saleVoid.rounding)} ke pelanggan
            di luar sistem. Sistem menanyakan gateway dulu; bila refund ternyata sudah berhasil, statusnya mengikuti
            gateway.
          </p>
          <TextField
            label="Bagaimana uang dikembalikan?"
            value={note}
            maxLength={MANUAL_NOTE_MAX}
            onChange={(e) => {
              setNote(e.target.value)
              setNoteError(undefined)
            }}
            error={noteError}
            placeholder="Contoh: transfer ke rekening pelanggan"
          />
          <div className="flex justify-end gap-2">
            <Button type="outline" color="light" width="auto" disabled={busy} onClick={() => setMarking(false)}>
              Batal
            </Button>
            <Button htmlType="submit" width="auto" isLoading={busy}>
              Tandai dikembalikan
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
