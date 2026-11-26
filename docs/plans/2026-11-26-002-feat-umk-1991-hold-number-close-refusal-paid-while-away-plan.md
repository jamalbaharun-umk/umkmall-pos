# UMK-2038, UMK-2044, UMK-2046: hold number, the shift-close refusal, sales paid while the till was away

Date: 2026-11-26. Epic UMK-1924, payment-api UMK-1991. pos-api only (pos-web follows, see "Not in this plan").
Builds on [2026-11-25-006 PG cashier flow](2026-11-25-006-feat-umk-1991-pg-cashier-flow-plan.md).

## Goal

1. **UMK-2038.** A receipt number is given when a sale is completed, not when it is rung up, so a sale that
   waits for a payment and is then cancelled leaves no gap in the store's receipt numbers. While it waits a sale
   is called by a hold number from its own counter.
2. **UMK-2044.** A shift that cannot close because sales await payment answers a stable code and the list of
   those sales, so the screen can name them and link to them.
3. **UMK-2046.** A till that was off (or closed, or offline) can ask which of its sales were paid meanwhile.

## Decisions

### UMK-2038 numbers

- **Two counters on the store's one `pos.sales_settings` row:** `last_sale_number` (receipts, as before) and
  `last_hold_number` (new). `sales.number` becomes nullable; `sales.hold_number` and `sales.completed_at` are new.
  Both counters are taken by `takeNumber` (`src/sales/numbers.ts`), an upsert that locks the store's row until
  the caller's transaction ends.
- **The rule is by the sale's first status, not by its payment method.** A sale written `completed` (payment-api
  off, or a kasbon) takes its receipt number in the transaction that creates it, as before. A sale written
  `awaiting_payment` (every sale that takes a payment while payment-api is on: PG, and also cash, EDC and static
  QRIS between their two steps) takes a hold number, and its receipt number in `PaymentSync.applyToSale`, the one
  write that completes it, under the sale's row lock. A cash sale still completes in the request that rings it
  up and is answered with its receipt number; the rule also closes the gap a cash sale left when payment-api
  closed its payment unpaid.
- **Receipt numbers follow the order of completion.** Two PG sales paid in the reverse order are numbered in the
  order they were paid.
- **A sale that is cancelled has no receipt number** (`number` null) and keeps its hold number. A database check
  (`sales_number_ck`) says: a completed or void sale has a number and a `completed_at`; an awaiting sale has a
  hold number.
- **Lock order.** Creating a sale: shift, counters row, then stock. Completing: the sale's row, then the counters
  row. Nothing takes the counters row and then an existing sale's row, so the two never wait for each other.
- **Answers.** Every sale answer (`POST /sales`, `GET /sales`, `GET /sales/:id`, the receipt) carries
  `receiptNumber` (null until completed), `holdNumber` (null for a sale that never waited) and `number`: the
  receipt number once there is one, else the hold number. The payment answer (`GET /sales/:id/payment` and its
  actions) carries `receiptNumber`, `holdNumber` and `saleNumber` by the same rule. `number` and `saleNumber`
  keep their old names and never become null for a sale the screen shows, because pos-web today requires an
  integer there and labels it by status ("Menunggu #", "Struk #"); a screen that needs to know which number it
  holds reads the two explicit fields.
- **Existing rows (migration `sale_hold_number`).** Final sales get `completed_at = paid_at`. Sales that await
  payment at that moment get hold numbers in the order they were rung up, and keep the receipt number they were
  created with: completing one uses it (no new gap), cancelling one leaves the gap it would have left before.
  Numbers of sales cancelled before this change are not touched: receipts already printed are not renumbered.
- Hold numbers never start again (no daily reset). See "Open".

### UMK-2044 the close refusal

`POST /shifts/current/close` with sales of the shift awaiting payment answers 409 with
`code: 'sales_awaiting_payment'` and `sales: [{ id, holdNumber, amountDue, paymentMethod, onlinePayment,
createdAt }]`, ordered by hold number. The sales are the closing actor's own shift's, in the session's store. The
message keeps its first words ("Masih ada penjualan yang menunggu pembayaran": pos-web matches them) and names
the hold numbers; `saleNumbers` stays, now the hold numbers.

### UMK-2046 paid while the till was away

`GET /sales/paid-since?since=<ISO time with offset>`: the sales that waited for a payment gateway and were
completed after `since`.

- "Since" is the caller's: the till remembers `asOf` of its last answer (or the time it last showed its waiting
  sales) and sends it. The server keeps nothing per device.
- **Compared with `sales.completed_at`,** the moment pos-api wrote the completion, never `paid_at`: a payment
  the job learns of late is dated at the customer's paid time, which can be before the till last looked.
- Whose: the actor's own sales, or all of the store's with `sales.void` (the same people who may open a sale's
  payment). Tenant from the session.
- Which: paid through a PG (`payment_method_code` is an online method). A sale switched to
  cash is not listed (the cashier did that at the till). A sale refunded since is listed with `status: 'void'`.
- Answer: `{ data: [{ id, number, receiptNumber, holdNumber, status, total, amountDue, paymentMethod, paidAt,
  completedAt, createdAt }], asOf }`, newest first, at most 50. `asOf` is the server's time less 10 seconds: a
  completion is stamped when its transaction starts and is visible when it ends, so the next request overlaps
  and the till drops the ids it already showed.
- 422 without `since` or with one that is not a time.

## Definition of Done

- `[test]` a PG sale awaits with a hold number and no receipt number; paid, it takes the next receipt number;
  cancelled, expired or refused by the gate, it takes none and the next completed sale continues the sequence
- `[test]` two PG sales paid in the reverse order are numbered in the order they were paid
- `[test]` a cash sale with payment-api on is answered with its receipt number at once; with payment-api down it
  waits with a hold number and the job gives it the next receipt number
- `[test]` with payment-api off, and for a kasbon, the number is taken at creation as before
- `[test]` races: a cancel, a switch to cash and the customer's payment at once; polls, checks and the job at
  once on several paid sales: every completed sale has one number, the numbers are 1..n, a cancelled sale has none
- `[test]` the store's receipts are numbered 1..n without a gap after a mix of all of the above, per store
  (store B's numbers do not move with store A's sales)
- `[test]` the migration's backfill: `completed_at`, hold numbers in order per store, the counter
- `[test]` the database refuses a completed sale without a number and an awaiting sale without a hold number
- `[test]` revert-red: taking the receipt number at creation again fails the gap tests
- `[test]` the close refusal: code, the sales with hold number and amount, only this shift's and this store's
- `[test]` paid-since: a sale paid while away is listed once after `since`; not before; own cashier only, all
  with `sales.void`; store B sees nothing of A; 422 on a bad `since`; a late-learned payment is still listed
- `[cmd]` `npm run lint && npm run typecheck && npm run build`, pos-api `jest --runInBand` on its own databases

## Files

- `apps/pos-api/src/db/schema/sales.ts`, `drizzle/NNNN_sale_hold_number.sql` (generated, plus the backfill)
- `apps/pos-api/src/sales/numbers.ts` (new), `sales.service.ts`, `sales.controller.ts`, `sales.schemas.ts`
- `apps/pos-api/src/payments-client/payment-sync.service.ts` (`applyToSale`), `sale-payment.service.ts`
- `apps/pos-api/src/shifts/shifts.service.ts`
- tests: `apps/pos-api/test/sale-numbers.e2e-spec.ts` (new); two lines in the existing payment suites

## Not in this plan

- pos-web. It keeps working unchanged (`number`, `saleNumber`, the refusal's message). Later: show the list of
  blocking sales on "Tutup shift" with links (`routes/kasir/tutup.tsx`), and a "dibayar selagi kasir mati" notice
  from `paid-since`.
- Sales that were cancelled or expired while the till was away (the resume check of one remembered sale covers
  the till's own last sale today).

## Open (owner)

1. Should the hold number start again every day (or every shift)? Today it only grows.
2. After the web reads `receiptNumber`/`holdNumber`, should `number` of a waiting sale become null?
3. Should `paid-since` also list cash/EDC sales that the job completed after a payment-api outage?
