import type { Receipt } from './-api'
import { reasonLabel } from './-void-helpers'

type MarkInput = Pick<Receipt, 'status' | 'voidedAt' | 'voidReasonCode' | 'refunded' | 'refundStatus'>

type MarkTitle = 'DIBATALKAN' | 'DIKEMBALIKAN' | 'Refund diproses' | 'Refund gagal, hubungi pemilik'

/**
 * The words printed over a receipt that is no longer valid; null for a valid one. A reversed PG sale says
 * DIKEMBALIKAN only once the gateway returned the money; a refund still pending or refused says so plainly, since
 * the customer has not been paid back yet.
 */
export function receiptMarkTitle(r: MarkInput): MarkTitle | null {
  if (r.status !== 'void') return null
  if (r.refundStatus === 'pending') return 'Refund diproses'
  if (r.refundStatus === 'failed') return 'Refund gagal, hubungi pemilik'
  return r.refunded || r.refundStatus === 'succeeded' ? 'DIKEMBALIKAN' : 'DIBATALKAN'
}

/**
 * Banner at the top of a voided or refunded receipt. A thick black border and bold capitals only (no colour, no
 * rotation), so it survives black-and-white thermal printing. Valid receipts render nothing. Every reversed sale
 * keeps "Struk ini tidak berlaku", also while its refund is pending or refused: the sale itself is reversed.
 */
export function ReceiptMark({ receipt }: { receipt: MarkInput }) {
  const title = receiptMarkTitle(receipt)
  if (!title) return null
  const loud = title === 'DIBATALKAN' || title === 'DIKEMBALIKAN'
  return (
    <div
      role="alert"
      data-testid="receipt-mark"
      className="mb-3 border-4 border-black p-2 text-center text-black"
    >
      <p className={loud ? 'text-xl font-bold tracking-wider' : 'text-base font-bold'}>{title}</p>
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
