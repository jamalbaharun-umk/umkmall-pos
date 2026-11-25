import { and, eq } from 'drizzle-orm';
import { paymentMethods } from '../db/schema';
import type { Tx } from '../stock/stock.service';

/**
 * UMK-1993: what a CASH total adds to reach the next Rp100, so no coin below Rp100 is needed
 * (Rp200.123 -> 77, amount due Rp200.200). 0 on a Rp100 boundary. Integer rupiah.
 */
export const cashRounding = (total: number) => (100 - (total % 100)) % 100;

/** The store's cash method, "Tunai", created on first use. */
export async function cashMethodId(tx: Tx, tenantId: string): Promise<string> {
  await tx
    .insert(paymentMethods)
    .values({ tenantId, name: 'Tunai', isCash: true })
    .onConflictDoNothing();
  const [m] = await tx
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.tenantId, tenantId),
        eq(paymentMethods.name, 'Tunai'),
      ),
    );
  return m.id;
}
