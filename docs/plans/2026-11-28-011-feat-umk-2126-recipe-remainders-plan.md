# feat(umk-2126): recipe remainders (design 43), cost-rise alert, suggested price, Produksi shortcut

Epic UMK-1924, issues UMK-2126 (and UMK-2125 follow-ups). Builds on the recipe list, detail and editor (PR 97, 100) and the
production screens (PR 101, 102). Design 43 ("Resep dan biaya per porsi") was approved on 2026-11-28. The recipe PDF
(third line of UMK-2126) is out of scope for this unit.

## Goal

1. A "Produksi" button on `/resep/$id` that opens `/produksi/baru` with the recipe preselected.
2. The cost-rise card on the dashboard: recipes whose cost per portion rose 5% or more since the product's cost price was last
   set, with the suggested price.
3. A "Harga usulan" panel on the recipe detail: target margin in, suggested selling price out, compared with the current price.

## Decisions

- **Threshold is 5%** (issue UMK-2126 and design rule 4: "naik 5% atau lebih sejak harga modal terakhir dipakai"). Integer test:
  `costPerPortion * 100 >= costPrice * 105`. A product with `cost_price = 0` (never applied) has no baseline and is never listed.
  A recipe with a missing or deleted ingredient cost is not listed either (its cost is incomplete, so a rise would be a guess).
- **Rise percent** is answered in tenths of a percent, integer, rounded half up: `risePermille = round((cost - base) * 1000 / base)`
  computed with BigInt; the screen divides by 10 only to print (8,7%). Margin now (design: "Margin Anda kini 56,3%") is likewise
  `marginPermille` of the current selling price, or null without a price.
- **Read lives in the recipes module**: `GET /recipes/cost-alerts`, behind `catalog.manage` like every recipe read (a holder of
  `reports.view` alone cannot open the recipe the card links to). The dashboard card hides itself on 403 like the widgets do.
  The route is declared before `GET /recipes/:id`. Tenant from the session; sorted by rise, largest first; at most 10 rows
  (`limit` 1..10, default 5) and a `total`.
- **Suggested price is computed by the server** (CLAUDE.md: the server computes every price): `GET /recipes/:id?targetMargin=60`
  adds `suggestedPrice: { targetMargin, price, costPerPortion, currentPrice, marginAtCurrentPermille } | null`. `targetMargin` is a
  whole percent 1..90 (default 60 from design 43); outside that, or not a number, 422. Math: `price = ceil(cost / (100 - m)) * 100`
  in BigInt, i.e. cost / (1 - m/100) rounded UP to the next Rp100 (design: Rp7.864 at 60% gives Rp19.700). Null when the cost per
  portion is 0 or incomplete (missing ingredient cost). It changes nothing by itself.
- **"Pakai sebagai harga jual"** (design screen 6) is built: it PATCHes `/catalog/products/:id` with `sellingPrice` only, the
  route that already needs `catalog.manage` and refuses a price below the cost price. A confirm dialog shows old and new price. No
  new server route, no new permission.
- **Produksi button**: the recipe page reads `GET /production-runs/plan?recipeId=&batches=1` in its loader; a `refusal` (recipe used
  as a sub-recipe, deleted ingredient, product not stocked) disables the button and the server's message is shown as the hint.
  A failed plan read never blocks the button (the production screen has its own states). `/produksi/baru` accepts an optional
  `recipeId` search param, accepted only when it is a uuid that names a listed recipe; otherwise ignored.
- No migration, no new table, no new nav entry (so no `guides.ts` change).

## Definition of Done

- [test] `test/recipe-remainders.e2e-spec.ts`: rise of 5% or more listed with integer figures and sorted by rise; 4,9% and a fall
  hidden; cost price 0 hidden; a purchase raising an ingredient makes the card appear; cross-tenant (store B sees none of A's);
  cashier without `catalog.manage` gets 403; `limit` out of range 422.
- [test] Same file: suggested price rounds up (7.864 at 60% gives 19.700; an exact multiple stays), margin 0, 91, 1.5 and "abc"
  give 422, default margin 60, `null` without a cost, cross-tenant 404 unchanged.
- [test] `src/recipes/suggest.spec.ts`: pure math (rounding up, exact multiples, bounds, huge cost stays exact).
- [test] web `routes/resep/-recipe.test.ts` and `routes/produksi/-run.test.ts`: search param validation, texts for the card, panel
  and hints.
- [cmd] `PGTEST_DB=pos_g1 PAYTEST_DB=pay_g1 npx jest --runInBand` (the new files, then the full suite once); `npx tsc --noEmit` and
  eslint on touched files in pos-api; `npx vitest run` and `npx tsc --noEmit` in pos-web.
- [qa] Desktop and phone width: no horizontal scroll, buttons single line through ActionRow, loading, empty and error state on the
  card and the panel, success toast and error dialog on "Pakai sebagai harga jual". Not viewed in a browser unless the report says so.

## Files

pos-api: `src/recipes/{suggest.ts,suggest.spec.ts,recipes.service.ts,recipes.controller.ts}`, `test/recipe-remainders.e2e-spec.ts`.
pos-web: `routes/resep/{$id.tsx,-api.ts,-recipe.ts,-recipe.test.ts,-suggest.tsx}`, `routes/produksi/{baru.tsx,-run.ts,-run.test.ts}`,
`routes/-dashboard/{api.ts,cards.tsx,index.tsx,wording.ts}`.
