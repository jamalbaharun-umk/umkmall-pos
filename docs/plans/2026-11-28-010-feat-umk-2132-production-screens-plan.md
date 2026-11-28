# feat(umk-2132): production screens (design 45), web side

Epic UMK-1924, issue UMK-2132, unit U-web. The server side is `docs/plans/2026-11-28-008-feat-umk-2132-production-runs-plan.md`
(PR 101); pos-api is not touched here. Design 45 ("Catat produksi untuk produsen rumahan") was approved on 2026-11-28.

## Goal

An owner (or a holder of `catalog.manage`) plans a production run (recipe and batches: what it needs against what is on
hand, the shortage shown), records it (actual yield, note), sees the list of past runs and one run in detail (lines,
planned against actual yield, cost per portion). pos-api computes every figure; the screens only present them.

## Screens

- `/produksi` list: date filter (from, to), paged (20), newest first; a bar chart of planned against actual yield of the
  runs shown; empty state "Belum ada produksi"; the button "Produksi baru".
- `/produksi/baru`: step 1 "Rencana" (recipe picker, number of batches, planned yield, table of ingredient needed against
  on hand, shortage badge, alert when `canProduce` is false), step 2 "Hasil nyata" (actual yield, note, "Catat produksi").
  The plan is read with `GET /production-runs/plan` after every valid change; the record button stays off until the plan
  on screen matches the form and `canProduce` is true.
- `/produksi/$id`: stat tiles (actual yield, planned yield, difference, cost per portion), ingredient lines table with
  quantity and cost, a bar chart (planned against actual) and a donut chart (ingredient cost shares), note, date.
- Navigation: group Inventori, label "Produksi", permission `catalog.manage`; a guide entry in `guides.ts`.
- Label maps: stock history reasons `production` ("Hasil produksi") and `production_use` ("Dipakai produksi") in the
  product page; audit event `production_run` ("Produksi dicatat") in the activity log helpers.

## Rulings taken in this unit

- **Idempotency.** `POST /production-runs` carries an `Idempotency-Key` made per submit and reused on a retry of the same
  request: the key is kept with the payload it was made for; a changed payload gets a new key, a success clears it. This
  makes a double tap or a lost answer record one run only.
- **Whole numbers.** Batches and yield are integers; "1.500" (thousands dot) is read as 1500, as on the recipe screens.
- **Refusals.** 422 `INSUFFICIENT_STOCK` (names every short ingredient, built from `shortages`, shortened to fit the
  error dialog), `INGREDIENT_DELETED`, `PRODUCT_NOT_STOCKED` open the shared error dialog with what happened and what to
  do; the form keeps its input.
- **No change to pos-api**, no new permission, no shortcut around `@umkmall/ui`.

## Definition of Done

- [test] `routes/produksi/-run.test.ts`: payload builder (integers, blank note null, "1.500" accepted), validation
  (batches 1..1000, yield 1..10.000.000, recipe required), plan query, shortage text (one and many, shortened, grouped
  digits), refusal text per code, idempotency key reuse and renewal, difference text, chart helpers, label maps.
- [test] `guides.test.ts` and `nav.test.ts` pass with the new entries (a nav screen without a guide fails).
- [cmd] `npx vitest run` and `npx tsc --noEmit` in `apps/pos-web`; `npx vite build` regenerates the route tree.
- [qa] Desktop and phone width: no horizontal page scroll, buttons single line and stacked on the phone (ActionRow),
  loading, empty and error state on each screen, success toast and error dialog on "Catat produksi".
- [manual] Not viewed in a browser in this unit unless stated in the report.

## Files

`apps/pos-web/src/routes/produksi/{-api.ts,-run.ts,-run.test.ts,index.tsx,baru.tsx,$id.tsx}`,
`apps/pos-web/src/nav.ts`, `apps/pos-web/src/guides.ts`, `apps/pos-web/src/routeTree.gen.ts` (generated),
`apps/pos-web/src/routes/catalog/products/$id/index.tsx`, `apps/pos-web/src/routes/pengaturan/-log-helpers.ts`
(+ its test).

## Tests to add

The vitest file above, plus label-map assertions in `-log-helpers.test.ts`.
