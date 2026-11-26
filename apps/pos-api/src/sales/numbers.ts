import { sql } from 'drizzle-orm';
import { salesSettings } from '../db/schema';
import type { Tx } from '../stock/stock.service';

/** The day a hold number belongs to is the store's day. One timezone until stores carry their own. */
export const HOLD_NUMBER_TIMEZONE = 'Asia/Jakarta';

/**
 * A store's two sale counters (UMK-2038), both on its one `pos.sales_settings` row:
 * - `receipt`: the receipt number. Taken ONLY in the transaction that writes a sale as completed, so the
 *   numbers of a store's receipts are unique and have no gap: a sale that is cancelled never took one.
 * - `hold`: what a sale is called while it awaits its payment ("Menunggu #n"). Gaps mean nothing here, and
 *   it starts at 1 again every store day (`hold_number_day`), so the numbers stay short. The answer's `day`
 *   is the day the number belongs to (`sales.hold_day`): a hold number is one of a kind per store and day.
 *
 * The upsert locks the store's row until the caller's transaction ends: two transactions never get the same
 * number, and a transaction that rolls back gives its number back. The day is compared and written in that
 * same statement, so two sales at midnight cannot both take number 1. Answers the row's tax rate too, which
 * the sale being created needs from the same row.
 *
 * `at` is the moment the number is taken; a test passes it, everything else leaves it to the database clock.
 */
export async function takeNumber(
  tx: Tx,
  tenantId: string,
  counter: 'receipt' | 'hold',
  at?: Date,
): Promise<{ number: number; taxBps: number; day: string | null }> {
  if (counter === 'receipt') {
    const [row] = await tx
      .insert(salesSettings)
      .values({ tenantId, lastSaleNumber: 1 })
      .onConflictDoUpdate({
        target: salesSettings.tenantId,
        set: { lastSaleNumber: sql`${salesSettings.lastSaleNumber} + 1` },
      })
      .returning({
        number: salesSettings.lastSaleNumber,
        taxBps: salesSettings.taxBps,
      });
    return { ...row, day: null };
  }
  const moment = at ? sql`${at.toISOString()}::timestamptz` : sql`now()`;
  const today = sql`(${moment} at time zone ${HOLD_NUMBER_TIMEZONE})::date`;
  const [row] = await tx
    .insert(salesSettings)
    .values({ tenantId, lastHoldNumber: 1, holdNumberDay: today })
    .onConflictDoUpdate({
      target: salesSettings.tenantId,
      set: {
        // A later day starts again at 1. The same day goes on counting, and so does an earlier one (a
        // clock that went back): its numbers stay in the day the counter is in, so none is given twice.
        lastHoldNumber: sql`case when ${salesSettings.holdNumberDay} >= ${today}
          then ${salesSettings.lastHoldNumber} + 1 else 1 end`,
        holdNumberDay: sql`greatest(${salesSettings.holdNumberDay}, ${today})`,
      },
    })
    .returning({
      number: salesSettings.lastHoldNumber,
      taxBps: salesSettings.taxBps,
      day: salesSettings.holdNumberDay,
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
