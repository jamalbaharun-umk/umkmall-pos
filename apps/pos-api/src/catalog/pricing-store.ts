import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { productPriceTiers, productUnits } from '../db/schema';
import type { PriceTier, ProductUnit } from './pricing';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type StoredPricing = {
  units: (ProductUnit & { id: string })[];
  tiers: PriceTier[];
};

/**
 * UMK-1985: the other units (smallest pack first) and wholesale tiers (lowest quantity first) of this
 * store's products. A product without any is absent from the map.
 */
export async function loadPricing(
  db: Db | Tx,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, StoredPricing>> {
  const map = new Map<string, StoredPricing>();
  if (!productIds.length) return map;
  const of = (id: string) => {
    let entry = map.get(id);
    if (!entry) map.set(id, (entry = { units: [], tiers: [] }));
    return entry;
  };
  const [units, tiers] = await Promise.all([
    db
      .select({
        id: productUnits.id,
        productId: productUnits.productId,
        name: productUnits.name,
        unitQty: productUnits.unitQty,
        price: productUnits.price,
      })
      .from(productUnits)
      .where(
        and(
          eq(productUnits.tenantId, tenantId),
          inArray(productUnits.productId, productIds),
        ),
      )
      .orderBy(asc(productUnits.unitQty), asc(productUnits.name)),
    db
      .select({
        productId: productPriceTiers.productId,
        minQty: productPriceTiers.minQty,
        price: productPriceTiers.price,
      })
      .from(productPriceTiers)
      .where(
        and(
          eq(productPriceTiers.tenantId, tenantId),
          inArray(productPriceTiers.productId, productIds),
        ),
      )
      .orderBy(asc(productPriceTiers.minQty)),
  ]);
  for (const { productId, ...u } of units) of(productId).units.push(u);
  for (const { productId, ...t } of tiers) of(productId).tiers.push(t);
  return map;
}
