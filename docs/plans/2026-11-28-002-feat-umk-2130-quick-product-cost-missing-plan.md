# UMK-2130: quick product from the till and the "cost missing" flag

Linear: UMK-2130. Design 44, screens 5 and 6 (owner approved 2026-11-28: sell first, complete the catalog later).

## Goal

An owner who meets a product that is not in the catalog sells it at once from the till, and the books never make the
profit look complete while products are sold without a cost.

## Decisions

- `POST /catalog/products/quick` `{ name, sellingPrice, costPrice?, barcode? }` behind `catalog.manage`, not an agent
  route. The product goes to the store's "Lainnya" category (created once, found ignoring case after that) as a
  `non_stock` product, so it sells without a stock-in. SKU generated as for any product. Cost not more than price.
- "Cost missing" = `cost_price = 0`, the convention of the products summary and of `cost_set_at` (UMK-2131).
  `GET /catalog/products` takes `cost=missing` and answers `costMissingCount` (following search and category, like the
  stock counts). Both are hidden from an actor who may not see costs (`withoutCost`).
- `GET /reports/profit-loss` answers `costMissing: { products }`: products sold in the period (completed receipts, by
  `paid_at`) on a charged line whose stored cost is 0. Their cost counted Rp0 in every profit.
- pos-web: "Produk cepat" on the till (search row, the empty grid and "Produk tidak ditemukan"), only with
  `catalog.manage`; "Tambah dan jual" puts one in the cart. Catalog: a "Modal belum diisi" badge in the cost column and
  a "Modal belum diisi (n)" filter chip. Untung rugi: a warning with a link to the filtered catalog.
- Review minors of PR 87 folded in: the owner PIN step's line says the owner makes it in Keamanan; a stray statement
  in the activation test; the journal's trailing newline.

## Definition of Done

- [test] Quick product: non-stock in "Lainnya", same category reused, barcode kept, sold at once; 422 on bad input
  (missing name/price, 0, fraction, cost above price, extra field, spaced barcode); 403 without `catalog.manage`
  (`test/quick-product.e2e-spec.ts`).
- [test] `cost=missing` filter and `costMissingCount` follow the search, hidden for a cashier; store B sees none of A's.
- [test] Profit and loss counts a product sold without cost and not one sold with cost; B counts 0.
- [test] pos-web: form checks (`-quick-product.test.ts`) and the P&L text (`-reports.test.ts`).
- [qa] Till at 375 px: empty grid → "Tambah produk cepat" → product in the cart (screenshot on the PR).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
