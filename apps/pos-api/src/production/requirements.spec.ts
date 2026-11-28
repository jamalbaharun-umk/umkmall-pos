import type { CostRecipe } from '../recipes/cost';
import { costPerPortion, requirements, wholeUnits } from './requirements';

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
const graph = (...rs: CostRecipe[]) => new Map(rs.map((r) => [r.id, r]));
const recipe = (
  id: string,
  yieldQty: number,
  lines: CostRecipe['lines'],
): CostRecipe => ({ id, yieldQty, laborCost: 0, lines });

const units = (m: Map<string, { n: bigint; d: bigint }>) =>
  Object.fromEntries([...m].map(([k, f]) => [k, Number(wholeUnits(f))]));

describe('production requirements (UMK-2132)', () => {
  it('multiplies each line by the batches', () => {
    const g = graph(recipe('nasi', 10, [ing('beras', 1500), ing('telur', 10)]));
    expect(units(requirements(g, 'nasi', 2))).toEqual({
      beras: 3000,
      telur: 20,
    });
  });

  it('takes the waste on top: qty × 100 / (100 − waste), rounded up once per ingredient', () => {
    // 100 g at 3% waste = 103.09… g per batch; 3 batches = 309.27… → 310, not 3 × 104 = 312.
    const g = graph(recipe('r', 1, [ing('minyak', 100, 3)]));
    expect(units(requirements(g, 'r', 3))).toEqual({ minyak: 310 });
  });

  it('sums an ingredient on two lines and inside a sub-recipe before rounding', () => {
    // Sambal: yield 3 portions from 10 g cabai + 1 g garam (0.333… g garam per portion).
    // Top: 1 g garam (one line), 1 g garam (another), 2 portions of sambal → 2 + 2/3 g = 2.67 g per batch.
    const g = graph(
      recipe('sambal', 3, [ing('cabai', 10), ing('garam', 1)]),
      recipe('top', 5, [ing('garam', 1), ing('garam', 1), sub('sambal', 2)]),
    );
    const exact = requirements(g, 'top', 3);
    // 3 batches: garam 6 + 2 = 8 g exactly; cabai 3 × 2/3 × 10 = 20 g.
    expect(units(exact)).toEqual({ garam: 8, cabai: 20 });
    expect(exact.get('garam')).toEqual({ n: 8n, d: 1n });
  });

  it('scales a sub-recipe by its yield exactly, with the sub line waste and nested levels', () => {
    // base: yield 4 from 100 g tepung. mid: yield 2 from 1 portion of base at 50% waste (2 portions taken).
    // top: 1 portion of mid. 1 batch of top = ½ mid batch = 1 base portion = ¼ base batch = 25 g tepung.
    const g = graph(
      recipe('base', 4, [ing('tepung', 100)]),
      recipe('mid', 2, [sub('base', 1, 50)]),
      recipe('top', 1, [sub('mid', 1)]),
    );
    expect(requirements(g, 'top', 1).get('tepung')).toEqual({
      n: 25n,
      d: 1n,
    });
    // 1/3 g would still take a whole gram.
    const odd = graph(
      recipe('base', 3, [ing('tepung', 1)]),
      recipe('t', 1, [sub('base', 1)]),
    );
    expect(units(requirements(odd, 't', 1))).toEqual({ tepung: 1 });
  });

  it('throws on a cycle instead of looping', () => {
    const g = graph(
      recipe('a', 1, [sub('b', 1)]),
      recipe('b', 1, [sub('a', 1)]),
    );
    expect(() => requirements(g, 'a', 1)).toThrow('recipe cycle');
  });

  it('cost per portion is the run cost ÷ the actual yield, rounded up once', () => {
    expect(costPerPortion(144_632, 19)).toBe(7_613); // design 45: 7612.2… → 7613
    expect(costPerPortion(100, 4)).toBe(25);
    expect(costPerPortion(101, 4)).toBe(26);
    expect(costPerPortion(0, 7)).toBe(0);
  });
});
