import { formatRupiah } from '../common/validation';

/**
 * UMK-1985: units and wholesale tiers of one product, and how a cart is priced from them. Pure functions:
 * the catalog validates and warns with them at product save, the sale and the quote price lines with them.
 *
 * - The base unit (`unit`, `sellingPrice`) is what stock is kept in.
 * - Another unit (`dus`) is `unitQty` base units at a fixed price; it is never tiered.
 * - A tier lowers the base unit price once the product's TOTAL quantity in the cart, in base units and
 *   across all its lines, reaches `minQty`.
 */
export type ProductUnit = { name: string; unitQty: number; price: number };
export type PriceTier = { minQty: number; price: number };
export type ProductPricing = {
  unit: string;
  sellingPrice: number;
  units: ProductUnit[];
  tiers: PriceTier[];
};

export type PricingIssue = { field: string; message: string };
export type PricingWarning = { code: string; field: string; message: string };

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What makes a product's units and tiers unsellable (422 at save), first problem per rule. `tiers` are
 * checked in the order given: `minQty` strictly increasing, prices strictly decreasing, none above the
 * base price. `priceField` names the input to blame when a tier is above the base price: the tier when
 * the tiers were sent, `sellingPrice` when only the base price changed.
 */
export function pricingIssues(
  p: ProductPricing,
  priceField: 'priceTiers' | 'sellingPrice' = 'priceTiers',
): PricingIssue[] {
  const issues: PricingIssue[] = [];
  p.units.forEach((u, i) => {
    if (same(u.name, p.unit))
      issues.push({
        field: `units.${i}.name`,
        message: 'Nama satuan tidak boleh sama dengan satuan dasar',
      });
    else if (p.units.slice(0, i).some((o) => same(o.name, u.name)))
      issues.push({
        field: `units.${i}.name`,
        message: 'Nama satuan tidak boleh ganda',
      });
  });
  p.tiers.forEach((t, i) => {
    const prev = p.tiers[i - 1];
    if (prev && t.minQty <= prev.minQty)
      issues.push({
        field: `priceTiers.${i}.minQty`,
        message:
          'Jumlah minimal grosir harus lebih besar dari baris sebelumnya',
      });
    if (prev && t.price >= prev.price)
      issues.push({
        field: `priceTiers.${i}.price`,
        message: 'Harga grosir harus lebih murah dari baris sebelumnya',
      });
    if (t.price > p.sellingPrice)
      issues.push(
        priceField === 'sellingPrice'
          ? {
              field: 'sellingPrice',
              message: 'Harga jual tidak boleh di bawah harga grosir',
            }
          : {
              field: `priceTiers.${i}.price`,
              message: 'Harga grosir tidak boleh melebihi harga jual',
            },
      );
  });
  return issues;
}

/**
 * Allowed, but worth telling the owner: a unit that costs more than its content bought loose in one go,
 * `unitQty ×` the price per base unit of the tier that `unitQty` itself reaches (the base price when it
 * reaches none). Owner ruling 2026-11-25: not the cheapest tier, which a single unit may never reach.
 */
export function pricingWarnings(p: ProductPricing): PricingWarning[] {
  return p.units.flatMap((u, i) => {
    const tier = tierFor(p.tiers, u.unitQty);
    const loose = u.unitQty * (tier ? tier.price : p.sellingPrice);
    if (u.price <= loose) return [];
    return [
      {
        code: 'unit_price_above_wholesale',
        field: `units.${i}.price`,
        message: `Harga 1 ${u.name} (${formatRupiah(u.price)}) lebih mahal dari ${u.unitQty} ${p.unit} dengan harga ${tier ? 'grosir' : 'satuan'} (${formatRupiah(loose)})`,
      },
    ];
  });
}

/** The tier a total base quantity reaches (the highest `minQty` at or below it), or null. */
export function tierFor(tiers: PriceTier[], baseTotal: number) {
  let hit: PriceTier | null = null;
  for (const t of tiers)
    if (t.minQty <= baseTotal && (!hit || t.minQty > hit.minQty)) hit = t;
  return hit;
}

/** The next tier above a total base quantity, with the base units still missing, or null. */
export function nextTierFor(tiers: PriceTier[], baseTotal: number) {
  let next: PriceTier | null = null;
  for (const t of tiers)
    if (t.minQty > baseTotal && (!next || t.minQty < next.minQty)) next = t;
  return next
    ? {
        minQty: next.minQty,
        price: next.price,
        remaining: next.minQty - baseTotal,
      }
    : null;
}

export type CartLine = { productId: string; qty: number; unit?: string };
export type PricedLine = {
  /** Unit name as the product spells it. */
  unit: string;
  /** Base units per unit: 1 for the base unit. */
  unitQty: number;
  baseQty: number;
  /** The unit's price before any tier. */
  normalUnitPrice: number;
  /** The server's price per unit: the tier price on a tiered base-unit line, else `normalUnitPrice`. */
  listPrice: number;
  appliedTier: PriceTier | null;
  /** What the tier saves on this line; 0 without one. */
  savings: number;
  /** Cart hint, the same on every line of the product. */
  nextTier: ReturnType<typeof nextTierFor>;
};

/** The product's unit a line names (case-insensitive; none = the base unit), or null when it has no such unit. */
export function unitOf(
  p: ProductPricing,
  name: string | undefined,
): { name: string; unitQty: number; price: number; isBase: boolean } | null {
  if (name === undefined || same(name, p.unit))
    return { name: p.unit, unitQty: 1, price: p.sellingPrice, isBase: true };
  const u = p.units.find((x) => same(x.name, name));
  return u ? { ...u, isBase: false } : null;
}

/**
 * Prices every line of a cart. The tier of a product comes from the sum of its lines in base units; it
 * prices the base-unit lines only. Returns null for a line whose unit the product does not have.
 */
export function priceLines(
  lines: CartLine[],
  pricingOf: (productId: string) => ProductPricing,
): (PricedLine | null)[] {
  const resolved = lines.map((l) => unitOf(pricingOf(l.productId), l.unit));
  const baseTotals = new Map<string, number>();
  lines.forEach((l, i) => {
    const u = resolved[i];
    if (u)
      baseTotals.set(
        l.productId,
        (baseTotals.get(l.productId) ?? 0) + l.qty * u.unitQty,
      );
  });
  return lines.map((l, i) => {
    const u = resolved[i];
    if (!u) return null;
    const p = pricingOf(l.productId);
    const baseTotal = baseTotals.get(l.productId)!;
    const tier = u.isBase ? tierFor(p.tiers, baseTotal) : null;
    const listPrice = tier ? tier.price : u.price;
    return {
      unit: u.name,
      unitQty: u.unitQty,
      baseQty: l.qty * u.unitQty,
      normalUnitPrice: u.price,
      listPrice,
      appliedTier:
        tier && tier.price < u.price
          ? { minQty: tier.minQty, price: tier.price }
          : null,
      savings: (u.price - listPrice) * l.qty,
      nextTier: nextTierFor(p.tiers, baseTotal),
    };
  });
}
