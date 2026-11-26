import { costDataRows } from './hpp';

describe('costDataRows', () => {
  it('joins catalog, sales and purchases by SKU, in integer rupiah', () => {
    const rows = costDataRows(
      [
        {
          id: 'p1',
          sku: 'UMK-kopi',
          name: 'Kopi',
          unit: 'Gelas',
          type: 'non_stock',
          sellingPrice: 15000,
          costPrice: 4251,
          stock: null,
        },
        {
          id: 'p2',
          sku: 'GULA',
          name: 'Gula',
          unit: 'kg',
          type: 'product',
          category: { name: 'Bahan' },
          sellingPrice: 18000,
          stock: 7,
        },
      ],
      [{ sku: 'UMK-kopi', qty: 3, sales: 45000, cost: 12753 }],
      [
        { sku: 'GULA', date: '2026-11-02', qty: 10, unitCost: 14000 },
        { sku: 'GULA', date: '2026-11-20', qty: 5, unitCost: 15500 },
      ],
    );
    expect(rows[0]).toMatchObject({
      hppRef: 'kopi',
      costPrice: 4251,
      sold: { qty: 3, averagePrice: 15000, averageUnitCost: 4251 },
      purchases: { qty: 0, averageUnitCost: null, lastUnitCost: null },
    });
    expect(rows[1]).toMatchObject({
      hppRef: null,
      category: 'Bahan',
      costPrice: null,
      stock: 7,
      sold: { qty: 0, averagePrice: null },
      purchases: {
        qty: 15,
        total: 217500,
        averageUnitCost: 14500,
        lastUnitCost: 15500,
        lastDate: '2026-11-20',
      },
    });
  });
});
