// UMK-2125 recipe costing: pure, integer only. Every intermediate figure is an exact BigInt fraction; the one
// rounding is `ceil` at the end, per portion (or per batch for the batch figure). No floats, no toFixed.

/** A recipe, its sub-recipe and that one's sub-recipe: 3 levels, the top recipe included. */
export const MAX_RECIPE_DEPTH = 3;
export const MAX_WASTE_PERCENT = 90;

/** Exact non-negative fraction. */
export type Frac = { n: bigint; d: bigint };

const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a;
};
const norm = (n: bigint, d: bigint): Frac => {
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
export const ZERO: Frac = { n: 0n, d: 1n };
export const add = (a: Frac, b: Frac) => norm(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac) => norm(a.n * b.n, a.d * b.d);
const ratio = (n: number, d: number) => norm(BigInt(n), BigInt(d));
/** Whole rupiah, rounded up. */
export const ceilFrac = (f: Frac) => Number((f.n + f.d - 1n) / f.d);

/** Rupiah per base unit as `amount / per` (manual cost Rp17.000 per 1.000 ml), or none known. */
export type UnitCost = {
  amount: number;
  per: number;
  source: 'purchase' | 'manual';
};

export type CostLine = {
  ingredientId: string | null;
  subRecipeId: string | null;
  quantity: number;
  wastePercent: number;
};

export type CostRecipe = {
  id: string;
  yieldQty: number;
  laborCost: number;
  lines: CostLine[];
};

export type LineCost = {
  /** Exact cost of the line in one batch; zero when its cost is missing. */
  cost: Frac;
  /** Ingredient ids (this line's or deeper) without any cost. */
  missing: string[];
};

export type RecipeCost = {
  batch: Frac;
  lines: LineCost[];
  missing: string[];
};

/** qty × unit cost × 100 / (100 − waste): the waste is part of what is bought. */
export function lineCost(
  quantity: number,
  wastePercent: number,
  unitCost: Frac,
): Frac {
  return mul(mul(ratio(quantity, 1), unitCost), ratio(100, 100 - wastePercent));
}

/**
 * Costs recipes of one store. `recipes` is the whole graph (sub-recipes included), `costs` the unit cost of every
 * ingredient that has one. Memoised: a sub-recipe used twice is costed once. Throws on a cycle (writes refuse
 * one, so this only guards against a broken graph).
 */
export function recipeCoster(
  recipes: ReadonlyMap<string, CostRecipe>,
  costs: ReadonlyMap<string, UnitCost>,
) {
  const memo = new Map<string, RecipeCost>();
  const visiting = new Set<string>();

  const costOf = (id: string): RecipeCost => {
    const hit = memo.get(id);
    if (hit) return hit;
    const r = recipes.get(id);
    if (!r) throw new Error('recipe not loaded');
    if (visiting.has(id)) throw new Error('recipe cycle');
    visiting.add(id);
    const lines = r.lines.map((l): LineCost => {
      if (l.ingredientId) {
        const c = costs.get(l.ingredientId);
        if (!c) return { cost: ZERO, missing: [l.ingredientId] };
        return {
          cost: lineCost(l.quantity, l.wastePercent, ratio(c.amount, c.per)),
          missing: [],
        };
      }
      const sub = costOf(l.subRecipeId!);
      const perPortion = mul(
        sub.batch,
        ratio(1, recipes.get(l.subRecipeId!)!.yieldQty),
      );
      return {
        cost: lineCost(l.quantity, l.wastePercent, perPortion),
        missing: sub.missing,
      };
    });
    visiting.delete(id);
    const out: RecipeCost = {
      batch: lines.reduce((sum, l) => add(sum, l.cost), ZERO),
      lines,
      missing: [...new Set(lines.flatMap((l) => l.missing))],
    };
    memo.set(id, out);
    return out;
  };

  /** The figures a recipe read answers, in whole rupiah. */
  const summary = (id: string) => {
    const r = recipes.get(id)!;
    const c = costOf(id);
    const portions = ratio(1, r.yieldQty);
    return {
      batchCost: ceilFrac(c.batch),
      costPerPortion: ceilFrac(mul(c.batch, portions)),
      // "HPP lengkap", read only: labour per batch added; fixed costs are not allocated here.
      fullCostPerPortion: ceilFrac(
        mul(add(c.batch, ratio(r.laborCost, 1)), portions),
      ),
      missingCostIngredientIds: c.missing,
      lines: c.lines,
    };
  };

  return { costOf, summary };
}

export type GraphProblem = 'cycle' | 'depth';

/**
 * Checks a store's recipe graph (recipe id → the sub-recipe ids its lines name): no recipe reaches itself, and
 * no chain is deeper than MAX_RECIPE_DEPTH levels (a recipe without sub-recipes is 1 level). Ids not in the map
 * count as leaves.
 */
export function checkRecipeGraph(
  edges: ReadonlyMap<string, readonly string[]>,
): GraphProblem | null {
  const depth = new Map<string, number>();
  const onPath = new Set<string>();
  const found = { cycle: false };

  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (onPath.has(id)) {
      found.cycle = true;
      return 0;
    }
    onPath.add(id);
    let d = 1;
    for (const child of edges.get(id) ?? []) {
      d = Math.max(d, 1 + visit(child));
      if (found.cycle) break;
    }
    onPath.delete(id);
    depth.set(id, d);
    return d;
  };

  let deepest = 0;
  for (const id of edges.keys()) {
    deepest = Math.max(deepest, visit(id));
    if (found.cycle) return 'cycle';
  }
  return deepest > MAX_RECIPE_DEPTH ? 'depth' : null;
}
