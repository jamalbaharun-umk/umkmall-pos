# UMK-2125 recipe screens (design 43)

Epic UMK-1924, issue UMK-2125. Screens for the recipe endpoints that already exist in `apps/pos-api/src/recipes/`.
Design: "Desain Fase 3", feature 43 (approved 2026-11-28). Only cost is shown: stock and sales do not change.

## Goal

An owner (or anyone with `catalog.manage`) lists recipes, opens one to see the cost per portion, margin, "HPP lengkap",
the ingredient cost share and the flags (deleted ingredient, missing cost), edits its lines, yield, labour and note, uses
the cost as the product's cost price ("Pakai harga modal"), and sets a manual cost for an ingredient that was never bought.

## Scope

- Routes `/resep` (list), `/resep/$id` (detail and editor), `/resep/baru` (create, same editor; the list's empty state
  and page action point to it).
- Nav: one line in `apps/pos-web/src/nav.ts`, permission `catalog.manage`.
- Not in this unit: the cost-rise warning card on the dashboard and "Harga usulan" (no endpoint yet), recipe PDF export,
  the coach mark (`CoachMark` is not in `@umkmall/ui` yet).

## Definition of Done

- [test] `-recipe.test.ts`: margin, cost shares (sum, ordering, folding of zero lines), payload builder (trims, integers
  only, one of ingredient or sub-recipe), validation messages mirror pos-api's zod, flag summary, unit cost text.
- [cmd] `npx vitest run` and `npx tsc --noEmit` in `apps/pos-web` are green; `nav.test.ts` still passes.
- [cmd] `npm run build -w pos-web` succeeds and `routeTree.gen.ts` lists the three routes.
- [qa] List shows loading skeleton, empty state with "Resep baru", error with retry, search, flags per row.
- [qa] Detail shows lines table (desktop) and stacked cards (phone), a donut of the cost share, "HPP lengkap",
  flags, and the actions in one ActionRow (single line, full width on a phone).
- [qa] Every action shows a success toast or the shared error dialog; a 422 from "Pakai harga modal" shows pos-api's text.
- [qa] Without `catalog.manage` the nav entry is hidden and the route answers the shared "no permission" state.
- [manual] Not looked at in a browser unless stated in the hand-off.

## Files

- `apps/pos-web/src/routes/resep/-api.ts` server functions (relay only; pos-api computes every figure).
- `apps/pos-web/src/routes/resep/-recipe.ts` (+ `.test.ts`) pure helpers.
- `apps/pos-web/src/routes/resep/-editor.tsx` form shared by create and edit; `-picker.tsx` product search select.
- `apps/pos-web/src/routes/resep/index.tsx`, `$id.tsx`, `baru.tsx`.
- `apps/pos-web/src/nav.ts` one line; `routeTree.gen.ts` regenerated.
