// UMK-2132 production runs: what a run of a recipe takes from stock and what one portion costs. Pure and integer
// only, on the exact fractions of src/recipes/cost.ts: the one rounding of a quantity is `ceil` per ingredient
// after the whole recipe tree is summed, and the one rounding of a cost is `ceil` per portion.
import {
  add,
  ceilFrac,
  type CostRecipe,
  type Frac,
  mul,
  ratio,
  ZERO,
} from '../recipes/cost';

/** Largest quantity a stock column holds (Postgres integer). A larger need is refused, never wrapped. */
export const MAX_STOCK_QTY = 2_147_483_647;

/** The largest unit cost a batch may carry: the cap opening stock and purchases enforce (Rp1 triliun). */
export const MAX_UNIT_COST = 1_000_000_000_000;

/** A quantity as a JS number for an answer: at most `MAX_STOCK_QTY` (a larger need is refused, never shown wrapped). */
export const clampQty = (units: bigint) =>
  units > BigInt(MAX_STOCK_QTY) ? MAX_STOCK_QTY : Number(units);

/** The waste is part of what is taken: a line takes qty × 100 / (100 − waste) of its ingredient or sub-recipe. */
const taken = (quantity: number, wastePercent: number): Frac =>
  mul(ratio(quantity, 1), ratio(100, 100 - wastePercent));

/**
 * Exact base units of every raw ingredient `batches` batches of recipe `recipeId` take, sub-recipes expanded: a
 * sub-recipe line runs its sub-recipe for (taken portions ÷ its yield) batches. `recipes` is the store's graph (a
 * cycle throws; writes refuse one). An ingredient on several lines or levels is summed before any rounding.
 */
export function requirements(
  recipes: ReadonlyMap<string, CostRecipe>,
  recipeId: string,
  batches: number,
): Map<string, Frac> {
  const out = new Map<string, Frac>();
  const onPath = new Set<string>();
  const walk = (id: string, times: Frac) => {
    const r = recipes.get(id);
    if (!r) throw new Error('recipe not loaded');
    if (onPath.has(id)) throw new Error('recipe cycle');
    onPath.add(id);
    for (const l of r.lines) {
      const amount = mul(times, taken(l.quantity, l.wastePercent));
      if (l.ingredientId)
        out.set(l.ingredientId, add(out.get(l.ingredientId) ?? ZERO, amount));
      else {
        const sub = recipes.get(l.subRecipeId!);
        if (!sub) throw new Error('recipe not loaded');
        walk(l.subRecipeId!, mul(amount, ratio(1, sub.yieldQty)));
      }
    }
    onPath.delete(id);
  };
  walk(recipeId, ratio(batches, 1));
  return out;
}

/** Whole base units to draw: rounded up (a part of a gram is still taken from the pack). */
export const wholeUnits = (f: Frac): bigint => (f.n + f.d - 1n) / f.d;

/** The finished portion's cost: what the drawn units cost ÷ the actual yield, rounded up to whole rupiah. */
export const costPerPortion = (ingredientCost: number, actualYield: number) =>
  ceilFrac(ratio(ingredientCost, actualYield));
