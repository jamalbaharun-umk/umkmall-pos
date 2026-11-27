# UMK-1990 + UMK-2072: the 30% gate on every manual discount, and stock shrinkage in profit and loss

Epic UMK-1924. Two owner rulings of 2026-11-26.

## A. The 30% PIN gate covers the order discount and a manual price (UMK-1990)

### Goal

The PIN approval above 30% (UMK-1990, plan 2026-11-26-008) applies to every manual reduction, not only a line
discount: the legacy order `discount` and a manual price (`lines[].price`, honoured with `sales.price_override`)
that is lower than the server's price by more than 30% of the line. One approval mechanism, extended, not copied.

### Rules (decisions taken here)

- One table, `pos.discount_approvals`, gains `scope` (`line` default, `order`). A `line` approval is bound to a
  product and covers that line's reduction from the server's price, given either as a line discount or as a
  lower manual price (the same share of the same line, so one approval kind). An `order` approval has no product.
  Migration: `scope` text not null default `line`, `product_id` nullable, check `(scope = 'order') = (product_id is
  null)`; `sales.discount_approved_by` (uuid, the order discount's approver).
- `POST /sales/discount-approvals` takes `scope` (optional, `line` by default, so older clients keep working);
  `productId` is required for `line` and refused for `order` (422). Self-approval, the PIN, its lockout, the 30
  minutes, single use and `maxBps` 3001–9999 are as before.
- Manual price: share = `(listPrice − price) × qty` of `listPrice × qty` (the server's price of the line's unit, the
  wholesale tier applied, the same base as a line discount). Above 30% → the line names an approval in its
  existing `discountApprovalId`. A price above the server's price needs none. A manual price of Rp0 on a line the
  server prices above Rp0 is refused (422 `DISCOUNT_INVALID`): like a discount, a manual price leaves at least Rp1
  (no approval can cover 100%).
- Order discount: base = subtotal − line discounts (what it comes off, manual prices already in the subtotal).
  Above 30% of that base → the sale names an `order` approval in a new top-level `discountApprovalId`. A
  discount of the whole base is refused (422 `DISCOUNT_INVALID`), more than it keeps its old message. Without
  `sales.price_override` the order discount stays silently ignored, as before.
- Refusal: 422 `DISCOUNT_APPROVAL_REQUIRED` on `lines.<i>.discountApprovalId` or `discountApprovalId`; the approval
  is taken inside the sale's transaction under `select … for update`, `used_at is null` (the existing path), so a
  replay and a same-key double tap answer the first sale and two sales on one approval let one through.
- The sale line records the approver of a manual price in `discount_approved_by`; an approved order discount writes
  `sales.discount_approved_by` and a `discount_approval` audit row with target the sale.
- Quote: optional line `price` (with `sales.price_override`, as the sale: the line is priced at it, `manualPrice`,
  no tier) and order `discount`; answers `priceNeedsApproval` per line, and `orderDiscount`,
  `orderDiscountNeedsApproval` at the top. Older quote bodies answer as before plus the flags (false).
- Cashier screen: the order discount entry was removed by UMK-1990 (line discounts replace it, design feature 30)
  and is not brought back. The "Beri diskon" dialog gains a third kind, **Harga** (a new unit price below the
  current one): its reduction is shown like a discount, the PIN step appears above 30%, and the sale sends `price`
  with the approval. The quote keeps the server's price (the screen computes the reduction on it).

### Definition of Done

- [test] e2e exact numbers: order discount 30% exact passes without approval, 30%+Rp1 refused, approved passes; base is
  after line discounts; manual price 30% below passes, more refused, approved passes and records the approver;
  price above list needs none; manual price Rp0 refused; a `line` approval does not serve the order and vice versa.
- [test] approval API: `scope` default `line`, `order` without product, `order` with product 422, `line` without product
  422; self-approval refused for `order` too.
- [test] idempotent replay and same-key double tap with an order approval; two sales on one order approval (one wins);
  cross-tenant (store B cannot use store A's order approval).
- [test] quote flags (`priceNeedsApproval`, `orderDiscountNeedsApproval`) with exact figures.
- [test] pos-web vitest: the dialog's price helpers.
- [test] revert-red: the order gate, the manual price gate.
- [qa] browser at 375 and 1024: Harga below 30% applied; above 30% asks PIN.

## B. Stock shrinkage reduces profit (UMK-2072)

### Goal

The profit and loss report shows "Susut stok": the batch cost of units an approved stock opname took out, between
gross profit and net profit like expenses. Surpluses add nothing. Gross profit stays the sales' figure.

### Rules

- shrinkage = Σ over `stock_movements` with reason `opname` and delta < 0, joined to the approved `stock_opnames`
  (`ref_id`), of `−delta × stock_batches.unit_cost` (the FIFO batch each unit came from). Dated by the opname's
  `approved_at` in the store timezone, the same half-open day bounds and period cutoff as sales. A draft opname has
  no movements; nothing else writes reason `opname`.
- netProfit = grossProfit − shrinkage − expenses. Label `shrinkage`: "Susut stok (selisih stok opname)". CSV row
  between gross profit and expenses. Web "Untung rugi": the line with a minus between gross profit and expenses,
  and a note that a surplus is not counted.
- The dashboard shows gross profit only: unchanged and still the same number as the report's gross profit.
- No migration (the `stock_movements_ref_idx` index serves the join).

### Definition of Done

- [test] e2e exact numbers: opname −2 units at cost 3.000 → shrinkage 6.000, net = gross − 6.000 − expenses; a −3 that
  draws across two batches (cost 2.000 then 2.500) → exact sum; a +5 surplus adds 0; a draft opname adds 0; another
  day's opname is out of the period; cross-tenant (store B's report unchanged); CSV row; dashboard gross profit equal.
- [test] revert-red: the `delta < 0` filter.
- [qa] browser at 375 and 1024: Untung rugi shows "Susut stok".

## Files

- `apps/pos-api/src/sales/` (schemas, service, line-discount), `src/db/schema/sales.ts`, one migration,
  `src/reports/reports.service.ts`, `src/expenses/profit-loss.service.ts`, `src/expenses/expenses.controller.ts`.
- `apps/pos-web/src/routes/kasir/` (`-discount.ts` + test, `-discount-dialog.tsx`, `-discount-api.ts`, `index.tsx`),
  `apps/pos-web/src/routes/laporan/` (`untung-rugi.tsx`, `-api.ts`).
- Tests: `apps/pos-api/test/discount-gate.e2e-spec.ts`, `apps/pos-api/test/shrinkage.e2e-spec.ts`.
