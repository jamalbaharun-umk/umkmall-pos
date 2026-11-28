# feat(umk-2125): recipes R1, server side (ingredient products, recipes, sub-recipes, cost per portion)

Epic UMK-1924, issue UMK-2125 (owner approved 2026-11-28; research "Wawancara UMKM: fitur berikutnya, onboarding
cepat, dan HPP resep", section "HPP resep"). pos-api only: no screen, no agent tool. Costing only: no stock deduction,
no change to the sale path beyond refusing an ingredient on the till.

## Goal

An owner (or a holder of `catalog.manage`) records how a sellable product is made: lines of ingredients and
sub-recipes with a quantity and a waste percentage, packaging as ordinary ingredient lines, and a yield per batch. The
server answers the cost of one portion in integer rupiah, following the latest purchase cost of every ingredient
(manual cost for an ingredient never bought), and on request writes that figure into the product's `cost_price`. The
selling price never changes.

## Rulings taken in this unit

- **Product type `ingredient`.** Bought and stocked like `product` (purchases, stock in, opname, batches), never sold:
  the sale path refuses it as an unknown/inactive product (422), so it cannot reach the till. The catalog keeps its
  existing validation (a selling price is still required; it is never used).
- **Units.** A line's quantity is an integer in the ingredient's base unit (`products.unit`: gram, ml, pcs), or in
  portions of the sub-recipe's yield. The read answers the unit; R1 stores no other unit per line.
- **Ingredient cost** (rational, never stored rounded): the newest `stock_batches` row with source `purchase`
  (`unit_cost` per base unit); otherwise the manual cost `pos.ingredient_costs` (`cost` rupiah for `per_qty` base
  units, e.g. Rp17.000 per 1.000 ml, so a price per gram can be a fraction); otherwise the line is "missing cost".
- **Waste** is an integer percent 0..90 of what is bought: a line costs `qty × unitCost × 100 / (100 − waste)`.
- **Cost per portion** = `ceil(Σ line costs / yield)`, computed with exact BigInt fractions; a sub-recipe line costs
  `qty × (sub batch total / sub yield)` exactly, so rounding happens once, at the end, per portion.
- **Depth.** A recipe, its sub-recipe and that one's sub-recipe: at most 3 levels including the top recipe
  (`MAX_RECIPE_DEPTH`). A cycle (a recipe reaching itself) or a 4th level is 422 on `lines`. Writes take a
  per-store advisory lock, so two concurrent edits cannot build a cycle together.
- **HPP lengkap** (read only): `ceil((batch total + labour per batch) / yield)`. `recipes.labor_cost` is the labour
  per batch. No share of expenses: no existing code allocates fixed costs to products, so `fixedCostsIncluded: false`.
  `cost_price` stays variable cost (cogs).
- **Apply cost** `POST /recipes/:id/apply-cost` (`catalog.manage`): sets `products.cost_price` to the cost per portion.
  422 when a line has no cost, when the product is an ingredient (its cost comes from purchases), or when the cost
  would exceed the selling price (the catalog's own rule).
- Every recipe route needs `catalog.manage` (the figures are costs). Tenant only from the session; another store's id
  is 404.

## Definition of Done

- [test] `src/recipes/cost.spec.ts`: integer cost per portion, rounded up once (not per line), waste, yield,
  sub-recipe fractions carried exactly, missing cost reported; graph check: cycle, self-reference, depth 3 accepted,
  depth 4 refused, and a recipe made deeper by an edit of its sub-recipe refused.
- [test] `test/recipes.e2e-spec.ts`: create/read/update/delete; a new purchase changes the cost; manual cost used for
  an ingredient never bought; apply-cost sets `cost_price` and leaves `selling_price`; a cashier without
  `catalog.manage` gets 403 on apply-cost and the reads, one with it succeeds; cycle and depth > 3 answer 422; bad
  input 422; store B gets 404 on store A's recipe for read, update, delete and apply-cost, and 422 when naming store
  A's ingredient or sub-recipe; an ingredient cannot be sold (422) and can be bought (purchase approved).
- [test] Revert-red once: the cycle check disabled makes the cycle test fail; restored.
- [test] `test/purge.e2e-spec.ts` seeds `recipes`, `recipe_lines`, `ingredient_costs`; the tenant_id guard and the
  erase test pass. `test/db.e2e-spec.ts` (RLS on every table) passes.
- [cmd] `npx tsc --noEmit -p apps/pos-api`, `npm run lint`, the full pos-api jest run with `PGTEST_DB=pos_recipes`.

## Files

- `apps/pos-api/src/db/schema/catalog.ts` (type `ingredient`, `STOCKED_TYPES`), `src/db/schema/recipes.ts` (new),
  `src/db/schema/index.ts` (one line), migration `drizzle/00NN_recipes.sql`.
- Stocked-type checks: `src/stock/stock.service.ts`, `src/purchasing/purchasing.service.ts`,
  `src/catalog/catalog.service.ts`, `src/agent/tools.ts` (stock-in preview); sale refusal in
  `src/sales/sales.service.ts`.
- `apps/pos-api/src/recipes/` (new): `cost.ts` (pure maths and graph check), `recipes.service.ts`,
  `recipes.controller.ts` (module), `cost.spec.ts`.
- `src/app.module.ts` (one line).
- Tests: `test/recipes.e2e-spec.ts` (new), `test/purge.e2e-spec.ts` (seed).

## Not in R1

Screens, the agent's `create_recipe`, cost-rise card, suggested price, PDF export, production runs (R2), stock deduction
on sale (R3), purchase units for ingredients on purchase lines, a 30-day average cost.
