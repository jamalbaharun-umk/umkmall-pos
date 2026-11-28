# feat(umk-2132): recipes R2, production runs (server side)

Epic UMK-1924, issue UMK-2132 (design 45 "Catat produksi untuk produsen rumahan", owner approved 2026-11-28; research
"Wawancara UMKM", row "R2. Catat produksi"). pos-api only: no screen (later), no agent tool, no change to the sale
path. Builds on recipes R1 (`src/recipes/`, UMK-2125) and the stock batches (`src/stock/stock.service.ts`).

## Goal

A home producer records "2 batches of nasi goreng, 19 portions came out". In one transaction the ingredients of the
recipe (sub-recipes expanded, waste included) leave stock FIFO, and the finished product enters stock as a new batch
of the ACTUAL yield, at the real ingredient cost of the run divided by the actual yield, in integer rupiah rounded up.
Planned yield (recipe yield × batches) and actual yield are both recorded. Missing ingredient stock refuses the run
(422 `INSUFFICIENT_STOCK`, naming each short ingredient with what is needed and what is there) and writes nothing.

## Rules kept

- Tenant only from the session; another store's recipe in the body is 422 on `recipeId`, another store's run is 404.
- Ingredients out FIFO through `StockService` (the same `draw` a sale uses: oldest batch first, `select … for update`),
  in product-id order (the order a sale locks). Before any draw, every needed ingredient's batches are locked and
  counted, so one shortage refuses the whole run with the full list, nothing written.
- Requirement per ingredient: Σ over the recipe tree of `qty × 100 / (100 − waste)` × batches, a sub-recipe line
  scaling its sub-recipe by `qty × 100 / (100 − waste) / subYield` batches. Exact BigInt fractions (the `Frac` math of
  `src/recipes/cost.ts`, reused), one `ceil` per ingredient at the end (stock is whole base units).
- Run cost = Σ of what the draws cost (each unit at its batch's `unit_cost`: integers, summed in BigInt). Cost per
  portion = `ceilFrac(cost / actualYield)` (`cost.ts`). Labour is not part of it (cost_price stays variable cost, as
  in R1). A cost past `Number.MAX_SAFE_INTEGER` (one draw or the sum) or a cost per portion past Rp1.000.000.000.000
  (the cap opening stock and purchases enforce) is refused, 422 `COST_TOO_LARGE`, nothing written. A need above the
  integer stock column (`MAX_STOCK_QTY`) is refused, 422 `QUANTITY_TOO_LARGE` on `batches`; the plan read shows such a
  need capped at `MAX_STOCK_QTY`, never wrapped.
- The run holds the store's recipe advisory lock in SHARED mode (`RecipesService.readLock`, the key recipe writes
  take exclusively) from before it reads the recipe graph until it commits: no recipe edit lands between the read
  and the draws, and runs do not wait for one another.
- The finished batch: `StockService.receive`, source `production`, ledger reason `production`, `source_id` = the run.
  Ingredient draws: ledger reason `production_use`, `ref_id` = the run.
- `Idempotency-Key` header (required): same key + same body answers the first run; same key + another body 422.
  A concurrent duplicate loses on the unique key and answers the first run. A duplicate that waited on the batch
  locks and then found the stock gone (or any other refusal) also answers the first run when one holds the key (as
  `sales.service.ts` does): a refusal is answered only when no run has the key.
- `catalog.manage` (as every recipe route). Not `@AgentRoute()`. Audit event `production_run` (group money) in the
  run's transaction: ids, quantities and amounts only.
- New tables `production_runs`, `production_run_lines`: `pos`, RLS, `tenant_id` FK, purge covers them (seeded in
  `test/purge.e2e-spec.ts`).

## Decisions

- **Stock in = actual yield**, not `yield × batches` (design 45 screen 2 and the issue: cost ÷ actual yield).
- **Sub-recipes are expanded to their raw ingredients**; stock of a sub-recipe's own product (an in-house ingredient)
  is not drawn. A store that keeps sambal in stock records the sambal as an ingredient line instead.
- **A recipe used as a sub-recipe by another recipe of the store cannot be run on its own** (422
  `RECIPE_USED_AS_SUB_RECIPE` on `recipeId`, naming the recipes that use it; the plan read shows the refusal). Its run
  would put the in-house ingredient into stock that the parent's run never draws, taking its raw ingredients twice
  (review of PR 101). The parent still runs, expanded to raw ingredients. **Open question for the owner:** a later
  change may let the parent draw the stocked sub-recipe product instead (and then allow running the sub-recipe).
- **An ingredient whose product type no longer keeps stock** (changed to service or non_stock after the recipe named
  it) refuses the run, 422 `INGREDIENT_NOT_STOCKED` naming it, never a shortage.
- **A deleted ingredient anywhere in the tree refuses the run** (422 `INGREDIENT_DELETED`); a deleted or unstocked
  finished product too (422 `PRODUCT_NOT_STOCKED` / not found).
- **Shortage over planned waste needs no reason** (design 45 open question, owner took the proposal): the difference
  planned − actual is only shown.
- **No void or undo** of a run: design 45 has none. Out of scope; a wrong run is corrected by opname.
- **A plan read** `GET /production-runs/plan?recipeId&batches` answers design 45 screen 1 (ingredients needed vs on
  hand, planned yield), read only, no locks. It carries `refusal` (`{ code, message }` of the refusal a run would get
  whatever the stock, or null) and `usedAsSubRecipeIn`.
- Migration number ≥ 0057; the stock source/reason checks gain `production` / `production_use`, re-added
  `NOT VALID` and then validated.

## Definition of Done

- [test] `src/production/requirements.spec.ts`: requirement per ingredient with waste, batches, an ingredient on two
  lines and inside a sub-recipe summed before one ceil, sub-recipe scaled by its yield exactly; cost per portion
  rounds up once.
- [test] `test/production-runs.e2e-spec.ts`: happy path (ingredient stock down FIFO across two batches, finished batch
  of actual yield at ceil(cost / actual yield), source `production`, ledger rows, planned vs actual, audit row); plan
  read; insufficient stock 422 `INSUFFICIENT_STOCK` with every shortage and nothing changed; sub-recipe expanded;
  idempotent retry (same key → same run, stock moved once; other body → 422); two concurrent runs cannot oversell
  (one 201, one 422, stock never negative); same key, same body, concurrent, stock for exactly one run: one run, both
  answer it; 403 without `catalog.manage`, 201 with it; deleted ingredient 422; a sub-recipe's own run 422
  `RECIPE_USED_AS_SUB_RECIPE` with nothing written, its parent runs on raw ingredients; finished product without stock
  422 `PRODUCT_NOT_STOCKED`; an ingredient turned non_stock 422 `INGREDIENT_NOT_STOCKED`; a need past the integer
  column 422 `QUANTITY_TOO_LARGE` (plan capped); a draw or a sum past the safe range and a cost per portion past the
  cap 422 `COST_TOO_LARGE`; a sale of the finished product completes while a run waits on its ingredient; store B: 404
  on store A's run, 422 naming store A's recipe, A's run not in B's list; list date filter; bad input 422.
- [test] Revert-red once: the batch row locks removed (`for update` in the lock and the draw) make the race test fail;
  restored. Also: the same-key replay of a refusal removed makes the exactly-one-run race fail (422); the sub-recipe
  refusal removed makes both sub-recipe tests fail (the parent then finds the cabai already taken).
- [test] `test/purge.e2e-spec.ts` seeds a production run; tenant_id guard and erase test pass; `test/db.e2e-spec.ts`
  (RLS) passes.
- [cmd] `npx tsc --noEmit -p apps/pos-api`, eslint on touched files, the full pos-api jest run (own `PGTEST_DB`).

## Files

- `apps/pos-api/src/db/schema/production.ts` (new), `src/db/schema/stock.ts` (source/reason), `src/db/schema/index.ts`
  (one line), `drizzle/00NN_production_runs.sql`.
- `src/recipes/cost.ts` (export the fraction helpers), `src/production/requirements.ts` (+ spec),
  `src/production/production.service.ts`, `src/production/production.controller.ts`, `src/app.module.ts` (one line).
- `src/stock/stock.service.ts` (a public FIFO draw for production), `src/audit/events.ts` (one code).
- Tests: `test/production-runs.e2e-spec.ts`, `test/purge.e2e-spec.ts`.
