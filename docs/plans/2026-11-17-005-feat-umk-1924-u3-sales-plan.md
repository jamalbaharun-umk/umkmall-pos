# UMK-1924 U3: cashier sells for cash inside a shift

Epic unit U3 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). Ported from Lakasir's `SellingService`,
`StockService`, `Selling`/`SellingDetail`/`CashDrawer`/`Stock` models and the classic cashier page
(`app/Filament/Tenant/Pages/Cashier.php`, not PosV2), with lakasir-findings.md flaws 2, 3, 4, 6, 8, 10 fixed by
design (1, 5, 7 belong to U7/U5).

## Goal

A cashier opens a shift with opening cash, rings up a cart, takes cash with quick amounts, sees the change, prints
a receipt, and closes the shift with counted cash against a server-computed expected cash. The server computes
every price and total, every sale is linked to the open shift, stock is drawn FIFO under a row lock in the sale's
transaction, a retried request makes one sale, and oversell is refused.

## Design

### Stock module (`src/stock/`, pushed first; U6 purchasing and opname build on it)

- `pos.stock_batches`: tenant, product, `qty_initial`, `qty_remaining` (check ≥ 0), `unit_cost` rupiah,
  `received_at`, `source` `opening|purchase|adjustment`, `source_id`. `pos.stock_movements` ledger: tenant, product,
  batch, signed `delta`, `reason` `opening|sale|sale_void|purchase|opname`, `ref_id`, `actor_id`, `created_at`.
  On-hand = sum of `qty_remaining`. Lakasir kept a `products.stock` column plus batches and drew "latest" without
  locks (flaw 8); here batches are the only truth.
- `StockService` (exported), every write takes the caller's Drizzle transaction:
  `receive` (new batch + movement; source `adjustment` records reason `opname` unless told otherwise),
  `consume` → `{ costTotal }` (FIFO: oldest `received_at` first, `select … for update` on the batches, 422 when the
  locked rows hold less than asked), `adjust` (positive: an `adjustment` batch at the latest batch cost; negative:
  a FIFO draw), `onHand(tenantId, productIds)`. Only `type = 'product'` tracks stock: `consume` of a service or
  non-stock product draws nothing and costs `cost_price × qty`; `receive`/`adjust` on one answers 422.
- Callers lock several products in product-id order (no deadlock between two multi-item sales).
- Routes: `GET /stock/products/:id` (on-hand + live batches), `POST /stock/opening` `{productId, qty, unitCost?}`
  (`catalog.manage`; once per product, 409 after that: later stock is a purchase or opname, U6).

### Shifts (`src/shifts/`)

- `pos.shifts`: tenant, `actor_id` + `actor_kind` (owner or cashier), `opening_cash`, `opened_at`, and on close
  `closed_at`, `counted_cash`, `expected_cash`, `cash_sales`, `sales_count`. One open shift per actor (partial unique
  index); a second open answers 409. Lakasir's cash drawer had no link to sales (flaw 4).
- `GET /shifts/current`, `POST /shifts/open` `{openingCash}`, `POST /shifts/current/close` `{countedCash}` →
  expected = opening + cash sales of the shift (each sale's `total`; `paid − change` is the same), difference =
  counted − expected. Close takes the shift row lock, the same lock a sale takes, so no sale lands after the count.
  `GET /shifts` and `GET /shifts/:id` for the history (cashiers see their own; `reports.view` sees all).
  Open/close need `sales.create`.

### Sales (`src/sales/`)

- `pos.payment_methods` (tenant, name, `is_cash`); "Tunai" seeded per tenant on first use (cash only in U3).
- `pos.sales_settings` (tenant PK, `tax_bps` default 0, `last_sale_number`): one upsert per sale returns the tax
  rate and the next receipt number (`number` unique per tenant). `GET/PUT /sales/settings` (`catalog.manage`).
- `pos.sales`: tenant, `number`, `shift_id` NOT NULL (composite FK with tenant), actor, payment method,
  `idempotency_key` (unique per tenant), integer rupiah `subtotal`, `discount`, `tax_bps`, `tax`, `total`, `paid`,
  `change`, `cost_total`, `override_by`. `pos.sale_lines`: product, name snapshot, qty, `list_price` (catalog
  price), `unit_price`, `line_total`, `cost_total`, `price_overridden_by`.
- `POST /sales` (`sales.create`, header `Idempotency-Key`, 8–100 chars `[A-Za-z0-9_-]`, else 422):
  body `{ lines: [{productId, qty, price?}], discount?, paid }`. A key already used returns the first sale. One
  transaction: lock the actor's open shift (422 if none) → upsert settings (number, tax) → load live products of the
  tenant (422 for an unknown one) → unit price = `selling_price`, or the client `price` only when the actor holds
  `sales.price_override` (then the line records the actor); the same rule for `discount` → subtotal, discount
  (≤ subtotal), tax = round((subtotal − discount) × bps / 10 000) on the amount AFTER the discount (flaw 2),
  total, paid ≥ total (422), change → insert sale (claims the key; a concurrent duplicate fails on the unique index
  and the API returns the winner) → `consume` each line in product order, cost always stored (flaw 3) → lines.
- `GET /sales` (paged; cashiers see their own, `reports.view` all; filter `shiftId`), `GET /sales/:id`,
  `GET /sales/:id/receipt` (number, time, cashier name, lines, totals). Cross-tenant ids answer 404.

### pos-web

- `/kasir`: open-shift form when none is open; else product search/grid, cart (qty +/−, remove), totals from the
  server preview rules shown as an estimate, pay dialog with quick cash amounts (exact, next Rp5.000/Rp10.000/
  Rp50.000/Rp100.000), change, submit with a per-cart idempotency key (a double tap or retry sends the same key),
  receipt page printed with the browser (`window.print`, 58/80 mm friendly CSS). `/kasir/tutup`: close shift with
  counted cash and the result. `/kasir/riwayat`: sales history with receipt links. Indonesian, loading/empty/error
  states, tablet layout, `api()` from `src/lib/api.server.ts`.

## Definition of Done

- [test] stock: FIFO cost across two batches with different costs; two transactions consuming the last unit with
  the first held open sell exactly one, the second gets 422 (revert-red once: drop `for update`, test fails,
  restore); not enough stock 422; a service product consumes nothing; cross-tenant 404 on `GET /stock/products/:id`
  and `POST /stock/opening`.
- [test] sales: client price ignored without `sales.price_override`; with it the price is used, the actor recorded,
  cost stored; idempotent retry (sequential and concurrent) makes one sale and one stock draw; no open shift 422;
  paid < total 422; tax on the amount after discount; unknown product / bad body / missing key 422.
- [test] slice check: 3 × Rp5.000, paid Rp20.000 → change Rp5.000, stock 50 → 47, sale carries the shift id.
- [test] shifts: second open 409; close computes expected = opening + cash sales, difference; sale after close 422.
- [test] cross-tenant: store B gets 404 on store A's sale, receipt, shift and stock ids; B's lists never show A's.
- [test] new tables have RLS (existing `db.e2e-spec.ts`).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green; CI green on `main`.
- [manual] pos-web cashier, close shift, history, receipt print preview in the browser; Indonesian, all states.
- [manual] not exercised: a thermal printer, sale void/refund, non-cash methods (U7/U9), tax setting UI.

## Files

- `apps/pos-api/src/stock/`, `src/shifts/`, `src/sales/` (modules, controllers, services, schemas).
- `apps/pos-api/src/db/schema/stock.ts`, `sales.ts`; one line each in `db/schema/index.ts`, `app.module.ts`; two
  migrations (stock, then sales).
- `apps/pos-api/test/stock.e2e-spec.ts`, `test/sales.e2e-spec.ts`.
- `apps/pos-web/src/routes/kasir/…`.

## Not in this unit

Voucher, member, credit (U7); purchases and opname screens (U6); reports (U5); void/refund; per-line discounts;
QRIS (U9); the device on the shift (one open shift per cashier is the rule).
