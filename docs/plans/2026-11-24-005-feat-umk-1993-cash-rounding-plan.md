# UMK-1993: round cash totals up to the next Rp100, server part

Unit: U3 follow-up (sales), touching the void (UMK-1962), the shift cash figures (UMK-1963) and the reports (U5).
Linear: UMK-1993. UI ("Pembulatan" on the cashier screen, receipt and reports) is in pos-web (see the [qa] line).

## Goal

A cash sale never needs a coin below Rp100: the amount due is the total rounded **up** to the next Rp100
(Rp200.123 becomes Rp200.200). The difference is stored on the sale in its own `rounding` field, so `total`, the
tax base and product revenue stay exactly as they are today.

## Rulings (owner, 24 Nov 2026)

- Rounding applies to **cash** sales only (`payment_methods.is_cash`). EDC debit, static QRIS/transfer and a
  kasbon sale charge the exact total (`rounding = 0`). A kasbon's cash down payment and cash instalments are the
  amount the customer hands over; they are not rounded.
- `total` is computed as today (tax after the discount and the voucher). Then
  `rounding = (100 - total mod 100) mod 100` and `amountDue = total + rounding`. Integer rupiah only.
- `rounding` is not part of the tax base, not in `total`, not in revenue and not in gross profit.

## Design

- **Storage:** `pos.sales.rounding` (bigint, default 0) and, for the reversal, `pos.sale_voids.rounding`
  (copied from the sale). Rows written before this change keep `rounding = 0`, also cash sales with a total off a
  Rp100 boundary: history is not rewritten.
- **Check constraints** (migration `0019`, the old ones dropped and added again in the same migration):
  - `sales_money_ck`: `total` is still `subtotal - discount - voucher + tax`; `rounding between 0 and 99`;
    `rounding = 0 or (total + rounding) % 100 = 0`; `change = greatest(paid - total - rounding, 0)`;
    `paid >= total + rounding` unless a member is set (kasbon).
  - `sale_voids_ck`: `cash_returned + transfer_returned + receivable_cancelled = total + rounding`.
  The database cannot see the payment method in a row check, so "non-cash is 0" is enforced by the service and
  pinned by tests.
- **Sale endpoint:** a cash sale needs `paid >= amountDue` (422 "Uang dibayar kurang dari jumlah yang harus dibayar", with `total`,
  `rounding` and `amountDue` in the body); `change = paid - amountDue`. Non-cash still needs `paid = total`.
  The request has no rounding field (strict schema): the server computes it.
- **Responses:** `POST /sales`, `GET /sales/:id` and `GET /sales/:id/receipt` carry `rounding` and `amountDue`
  next to `total`. `GET /sales` rows carry both; its summary gets `rounding` (net of voids in the window),
  `revenue` stays Σ `total`.
- **Shift:** `cashSales` is Σ (`paid - change`) of cash sales, which is now `total + rounding`. So the shift's
  cash sales and expected cash include the rounding exactly once, with no change to the query.
- **Void:** a rounded cash sale gives back `total + rounding` (what the drawer took in): `cash_returned`, the
  `sale_void_returns` row and the `void_refund` ledger entry carry that amount. The void response shows
  `rounding`.
- **Reports:** `revenue` = Σ `total` and `grossProfit` are unchanged. Every metrics block (dashboard
  current/previous, sales totals, product totals, shift rows and totals) gets `rounding` = Σ sales' rounding in
  the window minus Σ voids' rounding in the window, so a same-day void nets to zero and `revenue + rounding` is
  the money customers owed. CSV: sales and product exports get a `Pembulatan` line after `Laba kotor`; the shift
  export gets a `Pembulatan` column after `Laba kotor`.

## Definition of Done

- [test] `cashRounding`: 0 -> 0, 100 -> 0, 1 -> 99, 99 -> 1, 200123 -> 77; always 0..99 and `total + rounding`
  on a Rp100 boundary.
- [test] Cash sale with tax (total off the boundary): `total` and `tax` as today, `rounding` and `amountDue`
  as the formula, `change = paid - amountDue`; sale, list row and receipt show the same figures.
- [test] Cash sale paying the unrounded total is refused (422 on `paid`, body carries `amountDue`); paying
  exactly `amountDue` passes with change 0. A total on the boundary: `rounding = 0`.
- [test] Non-cash sale (debit) with the same total: `rounding = 0`, `paid = total`. Kasbon sale: `rounding = 0`,
  receivable rest = `total - paid`; a cash instalment is taken as handed over.
- [test] A replay (same `Idempotency-Key`) returns the same `rounding`.
- [test] `sales_money_ck` refuses a row with rounding inside `total`, rounding 100, a rounding that does not
  reach the boundary, and a change that ignores rounding. `sale_voids_ck` refuses a void that returns `total`
  only for a rounded sale.
- [test] Shift: `cashSales` and `expectedCash` (open and closed) include `total + rounding` once.
- [test] Void of a rounded cash sale: `cashReturned` = return amount = ledger `void_refund` = `amountDue`;
  expected cash is back at the opening cash; a debit void returns the exact total.
- [test] Reports: dashboard, sales, products and shift reports show `rounding` as its own figure; `revenue`,
  `tax` and `grossProfit` do not contain it; a same-day void nets `rounding` to zero; CSV has the line.
- [test] `GET /sales` summary: `rounding` net of voids, `revenue` without it.
- [test] Revert-red: the service line that rounds, the void amount, and the report reversal are each broken
  once to see the tests fail, then restored.
- [test] The amount charged through payment-api equals the amount due including rounding. NOT done here:
  stays a follow-up, pos-api does not call payment-api yet (see Follow-ups).
- [cmd] `npm run lint && npm run typecheck && npm run build`, `PGTEST_DB=pos_u1993 npx jest --runInBand`.
- [qa] Done (pos-web): the cashier screen shows "Pembulatan" and "Harus dibayar" for cash and computes change from
  the amount due; the printed receipt and the sale detail show both rows when rounding is above zero; the
  dashboard, the sales, products and shift reports and the history summary show "Pembulatan" as a line of its
  own, outside revenue and profit. Covered by unit tests of the pure helpers only (`hasRounding`, `cashRounding`,
  the report definitions); the screens themselves were not exercised in a browser.

## Files

- `apps/pos-api/src/db/schema/sales.ts` (`rounding`, `sales_money_ck`), `schema/voids.ts` (`rounding`,
  `sale_voids_ck`); migration `drizzle/0019_sale_rounding.sql` and its snapshot.
- `apps/pos-api/src/sales/sales.service.ts` (`cashRounding`, create, list, get, receipt).
- `apps/pos-api/src/void/void.service.ts` (amount given back, precheck, stored reversal, view).
- `apps/pos-api/src/shifts/shifts.service.ts` (comment only: the query already counts `paid - change`).
- `apps/pos-api/src/reports/reports.service.ts`, `reports.controller.ts` (`rounding` metric, CSV line).

## Tests to add

`apps/pos-api/test/rounding.e2e-spec.ts` (the DoD lines above). Existing tests keep their figures; an
expectation changes only where a cash total off a Rp100 boundary is now rounded, or where a response gains
the new fields.

## Follow-ups

- **payment-api integration:** when pos-api starts to record payments in payment-api, the amount of a cash
  payment is `amountDue` (`total + rounding`), and a void asks for that amount back. Add the DoD test there.
- **UI (UMK-1993):** done in pos-web (cashier screen, receipt, sale detail, history
  summary, reports). The cashier screen applies the same formula as pos-api, so "Uang pas" pays `amountDue`.
- **Consumer pricing rules:** rounding up always favours the store; one check before real users (M4, noted on
  the issue).
- **Accounting treatment:** `rounding` is reported apart and is in no profit figure. Whether it is booked as
  other income is the owner's call.

## Not in scope

rounding of non-cash or kasbon amounts, a per-store switch or another rounding step, payment-api.
