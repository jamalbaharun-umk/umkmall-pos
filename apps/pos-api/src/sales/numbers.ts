import { sql } from 'drizzle-orm';
import { salesSettings } from '../db/schema';
import type { Tx } from '../stock/stock.service';

/**
 * A store's two sale counters (UMK-2038), both on its one `pos.sales_settings` row:
 * - `receipt`: the receipt number. Taken ONLY in the transaction that writes a sale as completed, so the
 *   numbers of a store's receipts are unique and have no gap: a sale that is cancelled never took one.
 * - `hold`: what a sale is called while it awaits its payment ("Menunggu #n"). Gaps mean nothing here.
 *
 * The upsert locks the store's row until the caller's transaction ends: two transactions never get the same
 * number, and a transaction that rolls back gives its number back. Answers the row's tax rate too, which the
 * sale being created needs from the same row.
 */
export async function takeNumber(
  tx: Tx,
  tenantId: string,
  counter: 'receipt' | 'hold',
): Promise<{ number: number; taxBps: number }> {
  const column =
    counter === 'receipt'
      ? salesSettings.lastSaleNumber
      : salesSettings.lastHoldNumber;
  const key = counter === 'receipt' ? 'lastSaleNumber' : 'lastHoldNumber';
  const [row] = await tx
    .insert(salesSettings)
    .values({ tenantId, [key]: 1 })
    .onConflictDoUpdate({
      target: salesSettings.tenantId,
      set: { [key]: sql`${column} + 1` },
    })
    .returning({
      number: column,
      taxBps: salesSettings.taxBps,
    });
  return row;
}

/**
 * A sale's numbers as every answer carries them:
 * - `receiptNumber`: the receipt number, null until the sale is completed (and for ever on a cancelled one).
 * - `holdNumber`: "Menunggu #n", null for a sale that never waited for its payment.
 * - `number`: the one to show now: the receipt number once there is one, else the hold number. Screens
 *   written before UMK-2038 read only this, and label it by the sale's status ("Menunggu #", "Struk #").
 */
export const saleNumbers = (sale: {
  number: number | null;
  holdNumber: number | null;
}) => ({
  number: sale.number ?? sale.holdNumber,
  receiptNumber: sale.number,
  holdNumber: sale.holdNumber,
});
