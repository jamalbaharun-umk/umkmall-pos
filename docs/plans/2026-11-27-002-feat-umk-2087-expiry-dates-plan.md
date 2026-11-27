# UMK-2087: expiry date per stock batch and "Segera kedaluwarsa"

Epic UMK-1924, owner approved. Goal: a store can record an optional expiry date when stock comes in, and the
dashboard warns about stock that expires within 30 days or already has.

## Rules (decisions taken here)

- `pos.stock_batches.expires_at` (`date`, nullable) is the best-before day of the batch. `pos.purchase_order_lines.expires_at`
  (`date`, nullable) holds it on a purchase draft until approval copies it onto the batch. Migration `0053`
  (0052 is `summaries_target_tax_set`, on another branch).
- Stock comes in through `StockService.receive` only (opening stock and purchase approval; an opname or return
  never sets a date). `expiresAt` is `YYYY-MM-DD` (`LocalDate`, 422 on a malformed or impossible day) and must not
  be before the store's today, the day the stock is received (`storeToday`, the store timezone). A purchase line is
  checked when the draft is written (`lines.N.expiresAt`) and again when it is received.
- FIFO and stock arithmetic do not change: the date is read, never used to order or draw batches.
- `GET /reports/widgets/expiring?days=30&limit=5` (`reports.view`, tenant from the session): batches with
  `qty_remaining > 0` and `expires_at <= today + days`, grouped by product (qty summed, earliest date), soonest
  first; `expired` is true when that date is before today. `days` 1 to 365, `limit` 1 to 10, else 422. `total` and
  `expired` count all products, `rows` are cut to `limit`.
- Web: an optional date per line on the purchase form, the date on a purchase's lines, and a dashboard card that
  loads and fails on its own, is hidden without `reports.view`, with empty and error states.

## Definition of Done

- [test] Opening stock and purchase stock-in with and without `expiresAt` store and return it (`GET /stock/products/:id`, purchase lines).
- [test] A date before today, an impossible day and a wrong format are 422; today is accepted; nothing is received on a refusal.
- [test] A draft purchase keeps its line date and approval puts it on the batch.
- [test] `expiring`: soonest first, `expired` flag, qty 0 and undated batches left out, `days` and `limit` narrow it, bad `days`/`limit` are 422.
- [test] `expiring` needs `reports.view` (403 without).
- [test] Cross-tenant: store B sees none of store A's expiring stock and cannot receive into A's product.
- [test] Revert-red: with the past-date check disabled the 422 tests fail (run once, restored).
- [test] Web: `formatDay`, `expiryText`, `expiringFooter` and `checkExpiry` unit tests.
- [cmd] `PGTEST_DB=pos_f42 npx jest --runInBand test/stock-expiry test/db.e2e-spec.ts` green (every table keeps RLS).
- [cmd] `npx tsc --noEmit` in both apps, `npx vitest run` in apps/pos-web, `npm test` in apps/pos-api.
- [qa] Dashboard: the card shows names, date and "Kedaluwarsa N hari lagi" badges on desktop and a 360 px phone, danger badge for past dates, empty text when nothing expires.
- [manual] Purchase form: the date field per line on desktop and mobile; a past date shows the server message on the line.

## Files

- `apps/pos-api/src/db/schema/{stock,purchasing}.ts`, `drizzle/0053_stock_batch_expiry.sql` (+ snapshot, journal)
- `apps/pos-api/src/stock/{stock.service,stock.controller}.ts`, `src/purchasing/purchasing.service.ts`
- `apps/pos-api/src/reports/dashboard-widgets.{service,controller}.ts`
- `apps/pos-web/src/lib/expiry.ts`, `src/routes/pembelian/{-api,-validate,-order-form}.ts(x)`, `$id.tsx`
- `apps/pos-web/src/routes/-dashboard/{api,cards,index}.ts(x)`

## Tests to add

- `apps/pos-api/test/stock-expiry.e2e-spec.ts`
- `apps/pos-web/src/lib/expiry.test.ts`

## Not in scope

Selling expired stock is not blocked; no expiry on opname or sale-void batches; the opening-stock field of the
product form is not given a date input (the API accepts it).
