import { costDataRows, withRecipes } from './hpp';

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

describe('withRecipes (UMK-2127)', () => {
  const recipe = {
    id: 'r1',
    product: { id: 'p1' },
    yieldQty: 4,
    yieldUnit: 'porsi',
    laborCost: 400,
    note: null,
    lines: [
      {
        kind: 'ingredient',
        ingredientId: 'i1',
        subRecipeId: null,
        name: 'Tepung',
        quantity: 100,
        unit: 'GRAM',
        wastePercent: 0,
        unitCost: { amount: 10, per: 1, source: 'manual' },
        cost: 1000,
        missingCost: false,
        deleted: false,
      },
    ],
    batchCost: 1000,
    costPerPortion: 250,
    fullCostPerPortion: 350,
    fixedCostsIncluded: false,
    missingCostIngredientIds: [],
    deletedIngredientIds: [],
  };

  it('adds a recipe key only to a product that has one', () => {
    const rows = withRecipes(
      [{ productId: 'p1' }, { productId: 'p2' }],
      [recipe],
    );
    expect(rows[0]).toMatchObject({
      productId: 'p1',
      recipe: { id: 'r1', costPerPortion: 250, fullCostPerPortion: 350 },
    });
    expect('recipe' in rows[1]).toBe(false);
    expect(rows[1]).toEqual({ productId: 'p2' });
  });
});
