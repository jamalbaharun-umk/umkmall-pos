// UMKMall HPP → POS products (UMK-1980, owner request 2026-11-26). Pure helpers; the tool in tools.ts does the calls.

/** The category new HPP products land in, created when missing. */
export const HPP_CATEGORY = 'Dari HPP UMKMall';
export const HPP_SKU_PREFIX = 'UMK-';
export const HPP_MAX_ROWS = 50;

/** The SKU that links a POS product to its UMKMall HPP product; an import finds it and leaves it untouched. */
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

type CatalogRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  type: string;
  category?: { name: string };
  sellingPrice: number;
  costPrice?: number;
  stock: number | null;
  units?: unknown;
  priceTiers?: unknown;
};
type SoldRow = { sku: string; qty: number; sales: number; cost: number };
type BoughtRow = { sku: string; date: string; qty: number; unitCost: number };

/**
 * One row per product of everything UMKMall's HPP calculators need from the POS (owner direction 2026-11-26: UMKMall
 * pulls the products and does the calculation; the POS provides the data): prices, cost, stock, what sold and what
 * buying it really cost in the period. Integer rupiah, rounded; null where there is nothing to average.
 */
export function costDataRows(
  catalog: CatalogRow[],
  sold: SoldRow[],
  bought: BoughtRow[],
) {
  const soldBy = new Map(sold.map((s) => [s.sku, s]));
  const boughtBy = new Map<string, BoughtRow[]>();
  for (const b of bought)
    boughtBy.set(b.sku, [...(boughtBy.get(b.sku) ?? []), b]);
  return catalog.map((p) => {
    const s = soldBy.get(p.sku);
    const buys = boughtBy.get(p.sku) ?? [];
    const qty = buys.reduce((a, b) => a + b.qty, 0);
    const total = buys.reduce((a, b) => a + b.qty * b.unitCost, 0);
    const last = buys.at(-1);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      type: p.type,
      category: p.category?.name ?? null,
      sellingPrice: p.sellingPrice,
      costPrice: p.costPrice ?? null,
      units: p.units ?? [],
      priceTiers: p.priceTiers ?? [],
      stock: p.stock,
      hppRef: p.sku.startsWith(HPP_SKU_PREFIX)
        ? p.sku.slice(HPP_SKU_PREFIX.length)
        : null,
      sold: {
        qty: s?.qty ?? 0,
        sales: s?.sales ?? 0,
        cost: s?.cost ?? 0,
        averagePrice: s && s.qty > 0 ? Math.round(s.sales / s.qty) : null,
        averageUnitCost: s && s.qty > 0 ? Math.round(s.cost / s.qty) : null,
      },
      purchases: {
        qty,
        total,
        averageUnitCost: qty > 0 ? Math.round(total / qty) : null,
        lastUnitCost: last?.unitCost ?? null,
        lastDate: last?.date ?? null,
      },
    };
  });
}
