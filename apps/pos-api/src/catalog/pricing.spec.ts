import {
  nextTierFor,
  priceLines,
  pricingIssues,
  pricingWarnings,
  tierFor,
  type ProductPricing,
} from './pricing';

// The design's product: Teh Botol, Rp3.500 per pcs, dus of 24 at Rp78.000, 12+ → Rp3.300, 48+ → Rp3.200.
const teh: ProductPricing = {
  unit: 'pcs',
  sellingPrice: 3500,
  units: [{ name: 'Dus', unitQty: 24, price: 78_000 }],
  tiers: [
    { minQty: 12, price: 3300 },
    { minQty: 48, price: 3200 },
  ],
};
const price = (lines: { qty: number; unit?: string }[]) =>
  priceLines(
    lines.map((l) => ({ productId: 'teh', ...l })),
    () => teh,
  );
const totalOf = (lines: { qty: number; unit?: string }[]) =>
  price(lines).reduce((n, q, i) => n + q!.listPrice * lines[i].qty, 0);

describe('unit and wholesale pricing (UMK-1985)', () => {
  it('picks the tier at its exact minimum quantity', () => {
    expect(tierFor(teh.tiers, 11)).toBeNull();
    expect(tierFor(teh.tiers, 12)).toEqual({ minQty: 12, price: 3300 });
    expect(tierFor(teh.tiers, 47)).toEqual({ minQty: 12, price: 3300 });
    expect(tierFor(teh.tiers, 48)).toEqual({ minQty: 48, price: 3200 });
    expect(tierFor([], 1000)).toBeNull();
  });

  it('prices loose pcs by the QA table: 1, 11, 12, 47, 48', () => {
    expect(totalOf([{ qty: 1 }])).toBe(3500);
    expect(totalOf([{ qty: 11 }])).toBe(38_500);
    expect(totalOf([{ qty: 12 }])).toBe(39_600);
    expect(totalOf([{ qty: 47 }])).toBe(155_100);
    expect(totalOf([{ qty: 48 }])).toBe(153_600);
  });

  it('owner example: 1 dus + 6 pcs is 30 pcs, so the 6 pcs cost 6 × 3.300; the dus stays 78.000', () => {
    const [pcs, dus] = price([{ qty: 6 }, { qty: 1, unit: 'dus' }]);
    expect(pcs).toMatchObject({
      unit: 'pcs',
      unitQty: 1,
      baseQty: 6,
      normalUnitPrice: 3500,
      listPrice: 3300,
      appliedTier: { minQty: 12, price: 3300 },
      savings: 1200,
      nextTier: { minQty: 48, price: 3200, remaining: 18 },
    });
    expect(dus).toMatchObject({
      unit: 'Dus',
      unitQty: 24,
      baseQty: 24,
      normalUnitPrice: 78_000,
      listPrice: 78_000,
      appliedTier: null,
      savings: 0,
      nextTier: { minQty: 48, price: 3200, remaining: 18 },
    });
    expect(totalOf([{ qty: 6 }, { qty: 1, unit: 'dus' }])).toBe(97_800);
    expect(totalOf([{ qty: 6 }])).toBe(21_000);
    expect(totalOf([{ qty: 11 }, { qty: 1, unit: 'DUS' }])).toBe(114_300);
  });

  it('never tiers a dus line, whatever the quantity', () => {
    const [dus] = price([{ qty: 2, unit: 'dus' }]);
    expect(dus).toMatchObject({ listPrice: 78_000, appliedTier: null });
    expect(totalOf([{ qty: 2, unit: 'dus' }])).toBe(156_000);
    // 2 dus = 48 pcs: one loose pcs beside them gets the 48+ price.
    expect(price([{ qty: 2, unit: 'dus' }, { qty: 1 }])[1]).toMatchObject({
      listPrice: 3200,
    });
  });

  it('treats the base unit name as the base unit and answers null for an unknown unit', () => {
    expect(price([{ qty: 12, unit: 'PCS' }])[0]).toMatchObject({
      unit: 'pcs',
      listPrice: 3300,
    });
    expect(price([{ qty: 1, unit: 'karton' }])).toEqual([null]);
  });

  it('counts each product on its own', () => {
    const other: ProductPricing = { ...teh, units: [], tiers: teh.tiers };
    const priced = priceLines(
      [
        { productId: 'a', qty: 11 },
        { productId: 'b', qty: 11 },
      ],
      (id) => (id === 'a' ? teh : other),
    );
    expect(priced.map((q) => q!.listPrice)).toEqual([3500, 3500]);
  });

  it('next tier: remaining base units, null above the last tier', () => {
    expect(nextTierFor(teh.tiers, 5)).toEqual({
      minQty: 12,
      price: 3300,
      remaining: 7,
    });
    expect(nextTierFor(teh.tiers, 12)).toEqual({
      minQty: 48,
      price: 3200,
      remaining: 36,
    });
    expect(nextTierFor(teh.tiers, 48)).toBeNull();
  });

  it('rules: unit names, tier order, tier prices', () => {
    expect(pricingIssues(teh)).toEqual([]);
    const fieldsOf = (p: Partial<ProductPricing>) =>
      pricingIssues({ ...teh, ...p }).map((i) => i.field);
    expect(
      fieldsOf({ units: [{ name: ' PCS ', unitQty: 24, price: 1 }] }),
    ).toEqual(['units.0.name']);
    expect(
      fieldsOf({
        units: [
          { name: 'Dus', unitQty: 24, price: 1 },
          { name: 'dus', unitQty: 48, price: 1 },
        ],
      }),
    ).toEqual(['units.1.name']);
    const tiers = (...t: [number, number][]) =>
      fieldsOf({ tiers: t.map(([minQty, price]) => ({ minQty, price })) });
    expect(tiers([12, 3300], [12, 3200])).toEqual(['priceTiers.1.minQty']);
    expect(tiers([48, 3300], [12, 3200])).toEqual(['priceTiers.1.minQty']);
    expect(tiers([12, 3300], [48, 3300])).toEqual(['priceTiers.1.price']);
    expect(tiers([12, 3300], [48, 3400])).toEqual(['priceTiers.1.price']);
    expect(tiers([12, 3501])).toEqual(['priceTiers.0.price']);
    expect(tiers([12, 3500])).toEqual([]); // not above the base price
    expect(
      pricingIssues({ ...teh, sellingPrice: 3250 }, 'sellingPrice').map(
        (i) => i.field,
      ),
    ).toEqual(['sellingPrice']);
  });

  it('warns when a unit costs more than its content at the best price per base unit', () => {
    // 24 × 3.200 = 76.800 < 78.000: the design example itself warns (two dus cost more than 48 loose pcs).
    expect(pricingWarnings(teh)).toEqual([
      {
        code: 'unit_price_above_wholesale',
        field: 'units.0.price',
        message:
          'Harga 1 Dus (Rp78.000) lebih mahal dari 24 pcs dengan harga grosir termurah (Rp76.800)',
      },
    ]);
    expect(
      pricingWarnings({
        ...teh,
        units: [{ name: 'Dus', unitQty: 24, price: 76_800 }],
      }),
    ).toEqual([]);
    // Without tiers the best price is the base price: 24 × 3.500 = 84.000.
    expect(pricingWarnings({ ...teh, tiers: [] })).toEqual([]);
    expect(
      pricingWarnings({
        ...teh,
        tiers: [],
        units: [{ name: 'Dus', unitQty: 24, price: 84_001 }],
      }).map((w) => w.message),
    ).toEqual([
      'Harga 1 Dus (Rp84.001) lebih mahal dari 24 pcs dengan harga termurah (Rp84.000)',
    ]);
  });
});
