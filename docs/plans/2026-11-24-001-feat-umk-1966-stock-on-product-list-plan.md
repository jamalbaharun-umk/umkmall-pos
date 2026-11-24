# UMK-1966: on-hand stock on the product list endpoint (server part)

## Goal
`GET /catalog/products` returns `stock` per product so the cashier grid and catalog can show it.
The screens wait for an owner-approved design (label "Needs design").

## Definition of Done
- [test] The list returns on-hand stock for `type = product` in one grouped query (no N+1): `test/stock.e2e-spec.ts`.
- [test] `service` and `non_stock` rows return `stock: null`; a product with no batches returns 0.
- [test] Store B never sees store A's quantities.
- [cmd] lint, typecheck and tests pass.
- [qa] Grid and catalog show stock, zero shows "Habis": not done here (UI waits for design approval).

## Files
`apps/pos-api/src/catalog/catalog.service.ts`, `catalog.module.ts` (imports `StockModule`), `test/stock.e2e-spec.ts`.
