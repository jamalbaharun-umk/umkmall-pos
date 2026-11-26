// UMKMall HPP → POS products (UMK-1980, owner request 2026-11-26). Pure helpers; the tool in tools.ts does the calls.

/** The category new HPP products land in, created when missing. */
export const HPP_CATEGORY = 'Dari HPP UMKMall';
export const HPP_SKU_PREFIX = 'UMK-';
export const HPP_MAX_ROWS = 50;

/** The SKU that links a POS product to its UMKMall HPP product, so a second import updates it. */
export const hppSku = (ref: string) => `${HPP_SKU_PREFIX}${ref}`;

/**
 * UMKMall's `cogs` per unit (ingredients and modal, a float) as POS cost: whole rupiah, rounded up. Float noise
 * below a millionth of a rupiah is dropped first, so 1250.0000000002 stays 1250. Never UMKMall's `hpp`, which
 * adds allocated fixed costs the POS books as expenses.
 */
export const costFromCogs = (cogs: number) =>
  Math.ceil(Math.round(cogs * 1e6) / 1e6);

/** Per-product figures the agent can quote without arithmetic: average price, unit cost and margin. */
export function withMargins(
  rows: {
    productId: string;
    sku: string;
    name: string;
    qty: number;
    sales: number;
    cost: number;
    grossProfit: number;
  }[],
) {
  return rows.map((r) => ({
    ...r,
    hppRef: r.sku.startsWith(HPP_SKU_PREFIX)
      ? r.sku.slice(HPP_SKU_PREFIX.length)
      : null,
    averagePrice: r.qty > 0 ? Math.round(r.sales / r.qty) : null,
    averageUnitCost: r.qty > 0 ? Math.round(r.cost / r.qty) : null,
    // One decimal; null without sales (no margin to speak of).
    marginPercent:
      r.sales > 0 ? Math.round((r.grossProfit / r.sales) * 1000) / 10 : null,
  }));
}
