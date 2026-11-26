import type { Receipt } from './-api'
import { reasonLabel } from './-void-helpers'

type MarkInput = Pick<Receipt, 'status' | 'voidedAt' | 'voidReasonCode' | 'refunded'>

/** The word printed over a receipt that is no longer valid; null for a valid one. */
export function receiptMarkTitle(r: MarkInput): 'DIBATALKAN' | 'DIKEMBALIKAN' | null {
  if (r.status !== 'void') return null
  return r.refunded ? 'DIKEMBALIKAN' : 'DIBATALKAN'
}

/**
 * Banner at the top of a voided or refunded receipt. A thick black border and bold capitals only (no colour, no
 * rotation), so it survives black-and-white thermal printing. Valid receipts render nothing.
 */
export function ReceiptMark({ receipt }: { receipt: MarkInput }) {
  const title = receiptMarkTitle(receipt)
  if (!title) return null
  return (
    <div
      role="alert"
      data-testid="receipt-mark"
      className="mb-3 border-4 border-black p-2 text-center text-black"
    >
      <p className="text-xl font-bold tracking-wider">{title}</p>
      <p className="text-xs font-semibold">Struk ini tidak berlaku</p>
      {receipt.voidReasonCode && <p className="text-xs">Alasan: {reasonLabel(receipt.voidReasonCode)}</p>}
      {receipt.voidedAt && (
        <p className="text-xs">
          {new Date(receipt.voidedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
      )}
    </div>
  )
}
