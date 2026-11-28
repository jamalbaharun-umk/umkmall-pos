# UMK-2125 follow-ups: recipe screens review asks

Linear: UMK-2125 (epic UMK-1924). Builds on [2026-11-28-006](2026-11-28-006-feat-umk-2125-recipe-screens-plan.md).

## Goal

Two reviewer asks on the merged `/resep` screens. Web only, no pos-api change.

1. The product picker on `/resep/baru` must not let Anda pick a product that already has a recipe (pos-api answers 409).
   Today only the first page was filtered; search results were not. Fix: every option whose product id is in the
   recipes list is shown disabled with the hint "Sudah punya resep".
2. "Pakai harga modal" asks first: "Harga modal produk menjadi Rp X (sebelumnya Rp Y). Lanjutkan?" using the shared
   `useConfirm` dialog (new optional `color` so the button is not red). Only on confirm apply-cost runs; success
   toast and error dialog stay.

## Definition of Done

- [test] `pickerOptions` disables taken products, leaves others unchanged.
- [test] `applyCostConfirm` names the new and old cost price.
- [cmd] `npx vitest run` and `npx tsc --noEmit` in apps/pos-web; `guides.test.ts` passes.
- [qa] Not viewed in a browser in this change.

## Files

`apps/pos-web/src/routes/resep/{-recipe.ts,-recipe.test.ts,-picker.tsx,-editor.tsx,$id.tsx}`, `apps/pos-web/src/components/confirm.tsx`.
