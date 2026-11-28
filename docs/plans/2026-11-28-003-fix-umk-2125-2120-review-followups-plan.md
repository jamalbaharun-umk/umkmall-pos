# fix(umk-2125, umk-2120): review follow-ups of PR 89 (recipes R1) and PR 90 (solo-owner auto-open shift)

Epic UMK-1924, issues UMK-2125 and UMK-2120. One follow-up PR for the minors the reviewer left open on the two merged
PRs. No migration, no new route, no behaviour change beyond the points below.

## Goal

Close the reviewer's open minors: product-type lists that missed the new `ingredient` type, tenant conditions on two
joins, exact recipe math that can leave the safe integer range, apply-cost reading the price without a lock,
soft-deleted ingredients in a recipe, and a duplicate cash entry that could auto-open an empty shift. Strengthen the
solo-shift tests the reviewer called thin.

## Changes

PR 89 (recipes, UMK-2125):

- **(a) Type lists.** `summaries.service.ts` counts the stock status of the stocked types (`STOCKED_TYPES`), not
  `product` only. "Modal belum diisi" and the margin ranking stay on sellable products: an ingredient's cost comes from
  its purchases (its `cost_price` stays 0) and its selling price is never used, so counting it there would mislead. The catalog list takes `use=sale` (every type but `ingredient`, for the till grid) and `use=stock` (the stocked
  types, for the purchase and stock-opname pickers, which asked for `type=product` and so could not pick an
  ingredient). pos-web's `ProductType` includes `ingredient` ("Bahan baku"), its label map and the product form's
  stock fields follow `STOCKED_TYPES`. The catalog's stock-state SQL uses `STOCKED_TYPES` instead of a literal list.
- **(b) Tenant conditions** on the products join of the recipe load and the recipe_lines join of the graph check.
- **(c) Cost overflow.** `ceilFrac` refuses a result above `Number.MAX_SAFE_INTEGER` (throws `CostTooLargeError`)
  instead of rounding silently. Recipe create/update and manual-cost writes check every recipe of the store and answer
  422 when a cost figure would exceed `MAX_RECIPE_COST` (Rp1.000.000.000.000, the largest rupiah input). A read that
  still overflows (reachable only through a purchase or stock-in cost written later) answers 422, never a wrong figure
  or a 500.
- **(d) Apply cost under a row lock.** One transaction: the product row `select … for update`, the recipe costed, the
  selling-price check against the locked row, then the write. `cost_set_at` follows the 0054 trigger (set on the first
  cost above 0, kept on a later change).
- **(e) Deleted ingredients.** The recipe read flags a line whose ingredient is soft-deleted (`deleted: true`,
  `deletedIngredientIds`); apply-cost answers 422 on `lines` while one is.

PR 90 (solo-owner shift, UMK-2120):

- **(f) Duplicate racing a close.** `CashEntriesService.create` reads the key again inside its transaction before the
  drawer lock, and when the key turns up after the lock it rolls the transaction back before answering the first
  entry, so a duplicate that waited behind a shift close never commits an automatically opened empty shift or its
  audit row.
- **(g)** Test: a sale and a drawer expense that queue behind a shift close land in one new automatic shift.
- **(h)** Revert-red for the concurrent-first-sales test (on-conflict removed → red, restored → green); the wrong-PIN
  void test asserts no shift and no audit row appeared, with a correct-PIN control in the same store.

## Definition of Done

- [test] `src/recipes/cost.spec.ts`: `ceilFrac` throws above the safe range.
- [test] `test/recipes.e2e-spec.ts`: absurd quantities answer 422 (recipe write and manual cost); apply-cost waits for
  the product row lock and judges the selling price written meanwhile; `cost_set_at` set once and kept; a deleted
  ingredient is flagged in the read and apply-cost answers 422; tenant conditions keep the cross-tenant test green.
- [test] `test/summaries*.e2e-spec.ts` (or the recipes spec): an ingredient counts in the products summary.
- [test] catalog list `use=sale` leaves out ingredients, `use=stock` lists products and ingredients only.
- [test] `test/solo-shift.e2e-spec.ts`: (f) duplicate racing a close answers the first entry and leaves no new shift
  and no new audit row (revert-red: rollback removed → red); (g) sale and expense behind a close; (h) as above.
- [cmd] `npx tsc --noEmit` for pos-api and pos-web, eslint on touched files, full pos-api suite with
  `PGTEST_DB=pos_fu PAYTEST_DB=pay_fu`.

## Files

`apps/pos-api/src/recipes/{cost.ts,cost.spec.ts,recipes.service.ts}`, `src/summaries/summaries.service.ts`,
`src/catalog/{catalog.schemas.ts,catalog.service.ts}`, `src/shifts/cash-entries.service.ts`,
`test/{recipes,solo-shift}.e2e-spec.ts`, `apps/pos-web/src/routes/catalog/-api.ts`,
`apps/pos-web/src/routes/catalog/products/-form.tsx`, `apps/pos-web/src/routes/kasir/-api.ts`,
`apps/pos-web/src/lib/product-search.ts` (+ its spec).

## Open questions

- **Newest purchase beats a manual cost.** An ingredient with both a purchase and a manual cost is costed by the
  newest purchase, even when the manual cost was entered later. Left unchanged: it needs a product decision (newest of
  the two, or manual as an explicit override).
