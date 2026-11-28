import {
  ceilFrac,
  checkRecipeGraph,
  CostTooLargeError,
  type CostRecipe,
  recipeCoster,
  type UnitCost,
} from './cost';

const ing = (ingredientId: string, quantity: number, wastePercent = 0) => ({
  ingredientId,
  subRecipeId: null,
  quantity,
  wastePercent,
});
const sub = (subRecipeId: string, quantity: number, wastePercent = 0) => ({
  ingredientId: null,
  subRecipeId,
  quantity,
  wastePercent,
});
const recipe = (
  id: string,
  yieldQty: number,
  lines: CostRecipe['lines'],
  laborCost = 0,
): [string, CostRecipe] => [id, { id, yieldQty, laborCost, lines }];
const manual = (amount: number, per = 1): UnitCost => ({
  amount,
  per,
  source: 'manual',
});

describe('recipe cost (UMK-2125)', () => {
  it('costs the research example: Rp69.400 per batch of 40 → Rp1.735 a portion', () => {
    const costs = new Map<string, UnitCost>([
      ['singkong', manual(6_000, 1_000)], // Rp6.000/kg, base unit gram
      ['minyak', manual(17_000, 1_000)], // Rp17.000/L, base unit ml
      ['plastik', manual(250)],
      ['cabai', manual(12_400, 100)],
    ]);
    const { summary } = recipeCoster(
      new Map([
        recipe('keripik', 40, [
          ing('singkong', 5_000),
          ing('minyak', 1_000),
          sub('balado', 1),
          ing('plastik', 40),
        ]),
        recipe('balado', 1, [ing('cabai', 100)]),
      ]),
      costs,
    );
    const s = summary('keripik');
    expect(s.batchCost).toBe(69_400);
    expect(s.costPerPortion).toBe(1_735);
    expect(s.missingCostIngredientIds).toEqual([]);
    expect(Number.isInteger(s.costPerPortion)).toBe(true);
  });

  it('rounds up once per portion, never per line', () => {
    // Each line costs a third of a rupiah: three lines are exactly Rp1 (per-line rounding would say Rp3).
    const { summary } = recipeCoster(
      new Map([recipe('r', 1, [ing('a', 1), ing('a', 1), ing('a', 1)])]),
      new Map([['a', manual(1, 3)]]),
    );
    expect(summary('r').costPerPortion).toBe(1);
  });

  it('rounds a fraction of a rupiah up', () => {
    const { summary } = recipeCoster(
      new Map([recipe('r', 10, [ing('a', 10_001)])]),
      new Map([['a', manual(1)]]),
    );
    expect(summary('r').batchCost).toBe(10_001);
    expect(summary('r').costPerPortion).toBe(1_001); // 1.000,1 → 1.001
  });

  it('adds waste as part of what is bought: qty × 100 / (100 − waste)', () => {
    const { summary } = recipeCoster(
      new Map([recipe('r', 1, [ing('minyak', 700, 30)])]),
      new Map([['minyak', manual(10)]]),
    );
    expect(summary('r').costPerPortion).toBe(10_000); // 7.000 / 0,7
  });

  it('divides the batch by its yield', () => {
    const { summary } = recipeCoster(
      new Map([recipe('r', 4, [ing('a', 10)])]),
      new Map([['a', manual(100)]]),
    );
    expect(summary('r').costPerPortion).toBe(250);
  });

  it('carries a sub-recipe portion as an exact fraction', () => {
    // The sub-recipe costs Rp10 for 3 portions; 3 of them are exactly Rp10, not 3 × ceil(3,33) = Rp12.
    const { summary } = recipeCoster(
      new Map([
        recipe('top', 1, [sub('mid', 3)]),
        recipe('mid', 3, [ing('a', 10)]),
      ]),
      new Map([['a', manual(1)]]),
    );
    expect(summary('mid').costPerPortion).toBe(4);
    expect(summary('top').costPerPortion).toBe(10);
  });

  it('nests three levels, waste on a sub-recipe line included', () => {
    const { summary } = recipeCoster(
      new Map([
        recipe('a', 2, [sub('b', 1, 50)]),
        recipe('b', 1, [sub('c', 2)]),
        recipe('c', 4, [ing('x', 4)]),
      ]),
      new Map([['x', manual(100)]]),
    );
    // c: 400 for 4 → 100 each; b: 2 × 100 = 200; a: 200 × 100/50 = 400 for 2 → 200.
    expect(summary('a').costPerPortion).toBe(200);
  });

  it('reports an ingredient without cost, from this recipe or deeper, and counts it as zero', () => {
    const { summary } = recipeCoster(
      new Map([
        recipe('top', 1, [ing('a', 1), sub('mid', 1)]),
        recipe('mid', 1, [ing('unknown', 5)]),
      ]),
      new Map([['a', manual(500)]]),
    );
    expect(summary('top').costPerPortion).toBe(500);
    expect(summary('top').missingCostIngredientIds).toEqual(['unknown']);
  });

  it('adds labour per batch to "HPP lengkap" only', () => {
    const { summary } = recipeCoster(
      new Map([recipe('r', 40, [ing('a', 40)], 1_000)]),
      new Map([['a', manual(100)]]),
    );
    expect(summary('r').costPerPortion).toBe(100);
    expect(summary('r').fullCostPerPortion).toBe(125);
  });
});

describe('recipe graph check (UMK-2125)', () => {
  const g = (edges: Record<string, string[]>) =>
    checkRecipeGraph(new Map(Object.entries(edges)));

  it('accepts recipes without sub-recipes and a chain of 3 levels', () => {
    expect(g({ a: [], b: [] })).toBeNull();
    expect(g({ a: ['b'], b: ['c'], c: [] })).toBeNull();
    expect(g({ a: ['b', 'c'], b: ['c'], c: [] })).toBeNull();
  });

  it('refuses a recipe that uses itself', () => {
    expect(g({ a: ['a'] })).toBe('cycle');
  });

  it('refuses a cycle through other recipes', () => {
    expect(g({ a: ['b'], b: ['c'], c: ['a'] })).toBe('cycle');
    expect(g({ x: [], a: ['b'], b: ['a'] })).toBe('cycle');
  });

  it('refuses a 4th level', () => {
    expect(g({ a: ['b'], b: ['c'], c: ['d'], d: [] })).toBe('depth');
  });

  it('refuses an edit that makes a recipe above it too deep', () => {
    // c gains a sub-recipe d: c alone is 2 levels, but a → b → c → d is 4.
    expect(g({ a: ['b'], b: ['c'], c: ['d'], d: [] })).toBe('depth');
    expect(g({ c: ['d'], d: [], a: ['b'], b: ['c'] })).toBe('depth');
  });
});

describe('ceilFrac stays exact', () => {
  it('rounds up within the safe range and refuses a figure beyond it', () => {
    expect(ceilFrac({ n: 7n, d: 2n })).toBe(4);
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    expect(ceilFrac({ n: max, d: 1n })).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => ceilFrac({ n: max + 1n, d: 1n })).toThrow(CostTooLargeError);
  });

  it('a 3-level recipe at the input caps overflows: refused, not rounded', () => {
    const graph = new Map([
      recipe('c', 1, [ing('x', 10_000_000)]),
      recipe('b', 1, [sub('c', 10_000_000)]),
      recipe('a', 1, [sub('b', 10_000_000)]),
    ]);
    const costs = new Map([['x', manual(1_000_000_000_000)]]);
    expect(() => recipeCoster(graph, costs).summary('a')).toThrow(
      CostTooLargeError,
    );
  });
});
