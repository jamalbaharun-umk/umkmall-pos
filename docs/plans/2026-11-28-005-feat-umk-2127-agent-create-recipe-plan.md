# UMK-2127: agent `create_recipe` and the recipe breakdown in `hpp_product_data`

Linear: UMK-2127 (epic UMK-1924). So UMKMall's HPP calculator reads exact `cogs` per product instead of weights,
and the owner can dictate a recipe in chat. Builds on recipes R1 (UMK-2125, `src/recipes/`).

## Decisions

- **`create_recipe` calls the existing routes over loopback** like every write tool (`POST /recipes`, with the
  agent's own token), so validation (422 on unknown ingredient, cycle, depth, waste, cost cap), tenant filters and
  `catalog.manage` stay the route's. `POST /recipes` and `GET /recipes/:id` become `@AgentRoute()` (guard test list).
  `pos.write` carries `catalog.manage`, so a `pos.read`-only agent is refused by the tool (consent message) and by
  the route (403), like its siblings.
- **New products only.** Input is exactly one of `newProduct` (name, categoryId, sellingPrice, unit?, type
  `non_stock` | `product`) or `productId` of an existing product. A new product is created without a cost price
  (the agent never sets `cost_price`: the schema is strict, and `apply-cost` is not an agent route) and the
  recipe is written. An existing product only gets a **draft** (the recipe as checked, the product's current cost and
  price, `manualPath`): nothing is written, the owner enters it in the POS. A recipe never changes a selling price.
- **Preview / confirm / idempotency:** `runWrite` as for every write (preview without `confirm`, once per
  `idempotencyKey`, stored answer replayed, unknown outcome keeps the key). The preview checks the lines against the
  store (ingredient exists and is type `ingredient`; sub-recipe exists) so most refusals come before anything is
  written.
- **Atomicity.** The product and the recipe are two routes. The new product gets a SKU derived from the key
  (`RC-<12 hex>`, no `sku` input), so a retry after a refused recipe finds the product made by the first try
  (409 on the SKU, looked up) and writes the recipe on it instead of making a second product. A product found
  that way is used only when it has no recipe and carries this key's SKU.
- **Packaging** is an ingredient line (type `ingredient`, unit pcs); no separate field.
- **`create_ingredient`: not added.** An ingredient is stock-tracked and costed by purchases or a manual cost; the
  agent's create-product schema excludes `ingredient` on purpose and a cost on an ingredient is a price-like
  figure the agent should not invent. The owner creates ingredients in the POS (or imports them); the agent finds
  them with `search_products` (new optional `type` filter) and references them by id.
- **Recipe breakdown in `hpp_product_data`.** New read route `GET /recipes/breakdown?productIds=…` (up to 100 ids;
  `reports.view` or `catalog.manage`, so a `pos.read` agent can use it) reusing `RecipesService.read` (one graph
  load for all rows, no duplicated cost math). A product row with a recipe gets an extra `recipe` key (id, yield,
  labour, lines with unit cost and cost and `missingCost`/`deleted`, `batchCost`, `costPerPortion`,
  `fullCostPerPortion` = "HPP lengkap", `missingCostIngredientIds`); a product without one keeps exactly its old
  shape (no `recipe` key). **Gotcha kept:** the POS gives `cogs` (`costPerPortion`, variable cost); UMKMall's own
  `hpp` adds allocated fixed costs and must never be sent back as `cogs`; `fullCostPerPortion` adds labour only.

## Definition of Done

- [test] `test/agent-recipe.e2e-spec.ts`: `create_recipe` preview writes nothing; confirm creates the product (no
  cost price) and the recipe once per key (replay same answer, no second product); ingredient lines, a sub-recipe
  line, yield, waste % and a packaging line cost as `GET /recipes/:id` says; audit row as the agent (tool call
  record with the created id).
- [test] Refusals: unknown ingredient id, a non-ingredient product, cycle/depth via the route (422), a `costPrice`
  or `sku` input (strict), both or neither of `productId`/`newProduct`, `pos.read`-only agent (consent message).
- [test] Cross-tenant: store B's agent naming store A's ingredient, sub-recipe or product is refused, nothing written.
- [test] Existing product: draft only, no recipe written, cost and price unchanged.
- [test] `hpp_product_data`: rows with a recipe carry the breakdown and cost per portion equal to the recipe route;
  a row without a recipe has no `recipe` key and the old keys; works with a `pos.read` agent; store B sees none of A's.
- [test] `src/agent/hpp.spec.ts`: the merge helper.
- [test] `src/guards.spec.ts` agent route list and the docs/tool-name comparison in `agent.e2e-spec.ts` pass.
- [cmd] `tsc --noEmit`, eslint on touched files, full pos-api suite.
