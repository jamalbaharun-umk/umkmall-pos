# UMK-1924 U6: stock in — suppliers, purchasing and stock opname

Epic unit U6 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). Ported from Lakasir's tenant `Supplier`,
`Purchasing`, `StockOpname`, `StockOpnameItem` models, `PurchasingService`, `StockOpnameService` and the Filament
`SupplierResource`, `PurchasingResource`, `StockOpnameResource`, with the flaws below fixed.

## Goal

The owner (or a cashier holding `purchasing.manage`) keeps a supplier list, records purchase orders from a
supplier (lines: product, qty, unit cost) and approves them, which puts the goods into stock as batches at their
unit cost. A stock opname records counted quantities against the system quantity; approving it writes one
adjustment per line for the difference. Both approvals happen exactly once.

## Lakasir behaviour and the bugs found (read, not run end to end)

- **Approval is not idempotent.** `PurchasingService::updateStatus` and `StockOpnameService::updateStatus` never
  check the current status; only the Filament button's `visible()` hides it after approval. A second request
  (double click, retry, API) re-applies the opname adjustment; for purchases it re-marks batches ready and lets
  an approved order move to `cancelled` while its stock stays. No transaction, no lock.
- **Purchase totals drift.** `getUpdatedPrice` sums `stock->stock` (the batch's *remaining* quantity, decremented
  by sales) instead of the purchased quantity, so an order's total shrinks as its goods sell.
- **Deleting an opname corrupts stock.** `StockOpnameService::delete` adds every line's `actual_stock` back onto
  `product.stock`, approved or not — a draft opname deletion inflates stock by the whole counted quantity.
- **Opname approval `approved_at`** is set before the empty-items check (harmless only because it returns
  without saving).
- **Floats.** Stock, prices and totals are `double` columns.
- **Stock outside one module.** Purchasing writes `stocks` rows directly; opname edits `product.stock` or the
  last batch; no row locks (lakasir-findings.md 8).

## Design

- **Stock belongs to U3's `src/stock/` (session `u3-sales`).** U6 creates no stock tables and calls only
  `StockService.receive(tx, …)` (purchase, one batch per line at its unit cost, source `purchase`, source id =
  order id), `adjust(tx, {tenantId, productId, delta, reason: 'opname', refId, actorId})` and `onHand`.
  Order of work: suppliers and purchase orders without stock effects first; integrate once
  `feat(stock): stock module` is on `main`.
- **Permission** `purchasing.manage` added to `src/staff/permissions.ts` (additive). It gates every write and
  every approval; reads need only a session (same as catalog). Owners hold it implicitly.
- **Suppliers** (`pos.suppliers`): name, phone, address, soft delete. A deleted supplier keeps its orders; it
  cannot be picked for a new order.
- **Purchase orders** (`pos.purchase_orders`): supplier, status `draft|approved|cancelled`, payment method label
  (free text, e.g. "Tunai", "Transfer"; no payment-method table in v1), note, `total` integer rupiah =
  Σ qty × unit cost computed by the server from the lines (never sent by the client), created by, approved
  by/at. Lines (`pos.purchase_order_lines`): product (same tenant, live, type `product`), qty > 0 integer,
  unit cost ≥ 0 integer rupiah. Lines are replaced whole while the order is a draft; an approved or cancelled
  order is read-only.
- **Approve** (`POST /purchasing/orders/:id/approve`): one transaction, `select … for update` on the order row.
  Draft with ≥ 1 line → `receive` per line, status `approved`, approver = actor. Already approved → 200 with the
  order, no stock change (idempotent). Cancelled → 409. **Cancel**: draft → cancelled; approved → 409 (stock
  already in; reversal is a future return flow); cancelled → 200.
- **Stock opname** (`pos.stock_opnames`): status `draft|approved`, note, created by, approved by/at. Lines
  (`pos.stock_opname_lines`): product, counted qty ≥ 0, `system_qty` = `onHand` at the moment the line is saved,
  reason (text, optional). One line per product per opname. Difference = counted − system qty.
- **Approve opname**: one transaction, lock the opname row; draft with ≥ 1 line → `adjust(delta = counted −
  system_qty)` per line with a non-zero delta, status `approved`. Already approved → 200, nothing written.
  Deleting is allowed only for drafts (nothing to reverse — the Lakasir delete bug cannot happen).
- Totals and quantities are integers; rupiah via `rupiah()`. Every table: `pos`, RLS, `tenant_id` FK.
- Ids that are not UUIDs answer 404; bodies are zod-validated (422).

Routes: `GET/POST /suppliers`, `GET/PATCH/DELETE /suppliers/:id`; `GET/POST /purchasing/orders`,
`GET/PATCH/DELETE /purchasing/orders/:id` (PATCH/DELETE drafts only), `POST /purchasing/orders/:id/approve`,
`POST /purchasing/orders/:id/cancel`; `GET/POST /stock-opnames`, `GET/PATCH/DELETE /stock-opnames/:id`,
`POST /stock-opnames/:id/approve`.

## Definition of Done

- [test] suppliers CRUD + soft delete; cross-tenant 404 for read, update, delete; B's list never shows A's.
- [test] purchase order create computes the total server-side; a product of another store → 422/404; edit only
  as draft.
- [test] approved purchase raises `onHand` and creates a batch at the line's unit cost.
- [test] approving twice adds stock once (revert-red: remove the status check, test fails, restore).
- [test] a cancelled order adds nothing and cannot be approved; an approved order cannot be cancelled.
- [test] opname to a lower count writes a negative `opname` adjustment, once on double approval.
- [test] cashier without `purchasing.manage` → 403 on writes and approvals; with it → 2xx.
- [test] cross-tenant 404 for every order and opname route (read, update, delete, approve, cancel).
- [test] slice check: product at 47, buy 20 → 67; opname counted 65 shows −2 and leaves 65.
- [test] new tables have RLS (`db.e2e-spec.ts`).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green (`PGTEST_DB=pos_u6`); CI green on
  `main`.
- [manual] pos-web: `/pemasok`, `/pembelian` (list, create, detail with approve/cancel), `/stok-opname` (list,
  create, detail with approve); Indonesian; loading, empty, error states; UMKMall token styling.
- [manual] not exercised: FIFO vs "normal" batch draw (U3's stock module owns it), payment status / due dates,
  purchase returns, real receipts.

## Files

- `apps/pos-api/src/suppliers/`, `src/purchasing/`, `src/stock-opname/` (module, controller, service, schemas).
- `apps/pos-api/src/db/schema/purchasing.ts`, one line in `db/schema/index.ts`, one migration.
- `apps/pos-api/src/staff/permissions.ts` (+ `purchasing.manage`), one line per module in `app.module.ts`.
- `apps/pos-api/test/purchasing.e2e-spec.ts`.
- `apps/pos-web/src/routes/pemasok/…`, `routes/pembelian/…`, `routes/stok-opname/…`, dashboard link.
