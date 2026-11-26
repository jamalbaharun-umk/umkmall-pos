# UMK-1991: "Perlu ditinjau", "Buat QR baru", payment-page link (UMK-2041, 2042, 2043)

Date: 2026-11-26. Epic UMK-1924, payment-api UMK-1991. Builds on plans
[2026-11-25-006](2026-11-25-006-feat-umk-1991-pg-cashier-flow-plan.md) (the cashier's PG flow),
[2026-11-25-007](2026-11-25-007-feat-umk-1991-pg-cashier-web-plan.md) (its screens) and
[2026-11-26-001](2026-11-26-001-feat-umk-1991-pg-cashier-server-gaps-plan.md). The legal lock (UMK-1977) stays: the
only gateway is the local fake one, and online payments are on only with `NODE_ENV` `development` or `test`.

## Goal

Three gaps between the approved designs (26, 27) and the product, server first, then pos-web:

1. **UMK-2043** a payment-page link (`fake_checkout`) is an online method end to end.
2. **UMK-2041** the owner sees the money that arrived and paid no sale, and the refunds a gateway refused.
3. **UMK-2042** the cashier makes a new QR, VA or link for the same waiting sale, without ringing it up again.

## Decisions

### UMK-2043: payment-page link

- `GATEWAY_METHODS` (and so `ONLINE_METHODS`) gains `fake_checkout`; a new migration replaces the database check
  `payment_methods_gateway_method_ck`. payment-api already has the method and the contract's `checkout.paymentUrl`.
- `SalePayment.checkout` passes `paymentUrl` on **only when it is an `https:` URL** without credentials, at most
  2000 characters (`paymentUrlOf`); anything else is dropped, so the screen never shows or opens another scheme.
- Nothing else changes: the gate (`onlineEnabled`), the poll, the check, cancel, cash, refund are those of every PG
  method.

### UMK-2041: "Perlu ditinjau"

- `GET /payment-review` (`payments.manage`: the owner; an agent session holds no such permission). Tenant from the
  session. Query `needsReview=true|false` (optional), `page`, `perPage` (≤ 100); a bad query answers 422.
- Answer `{ enabled, receipts: { items, page, perPage, total }, failedRefunds: [...] }`.
  - `receipts.items[]`: `{ id, kind, amount, needsReview, refundStatus, receivedAt, saleId, saleNumber,
    saleStatus }`. Copied field by field from payment-api's `GET /unmatched-receipts` (the client copies only
    these: no payment id, no gateway reference, no fee, no actor). `saleId` is payment-api's order reference
    **only when it is a sale of this store** (looked up with `tenant_id = session.tenantId`); a kasbon
    instalment's reference or an unknown one answers `saleId: null`.
  - `failedRefunds[]`: this store's sales whose PG refund was refused (`sale_voids.refund_status = 'failed'`),
    newest first, at most 100: `{ saleId, saleNumber, amount, reasonCode, requestedAt }`. The owner acts on the
    sale's own page (retry, "dikembalikan manual"), which exist already.
- payment-api off: `{ enabled: false, … empty }`. No answer from payment-api: 503.
- Payments stuck awaiting are already listed by `GET /payment-sync/issues` and the waiting list; not repeated here.
- pos-web: `/perlu-ditinjau`, a nav entry with `payments.manage`.

### UMK-2042: "Buat QR baru"

This replaces the owner ruling of 2026-11-25 "there is no new QR for the same sale" (the request of UMK-2042).

- `POST /sales/:id/payment/renew` (`sales.create`, a person at the till; the sale's own cashier or a `sales.void`
  holder, like cancel) body `{ attempt }` (strict): **the attempt the screen shows**. → 200 SalePayment.
  - `attempt` is what makes a repeat safe: a sale already past it answers its current payment and makes nothing
    new. A double click never makes a third bill.
  - 409 `already_paid` (the customer paid the old bill first: the sale is completed with it), `not_awaiting`,
    `not_online` (a cash sale), `switching_to_cash`, `attempt_limit`, `cancel_refused` (the old bill could not be
    closed; the sale still waits on it); 422 on a bad body; 404 for another store's or another cashier's sale;
    503 `payment_unavailable` (the message says to check the status first, as for cash).
- **The intent is written before anything is closed**: `sales.payment_renew_at` (new column, a time). Then the
  request closes the old bill at payment-api (`cancel`, or `close` of the key when no payment has it), and only
  when payment-api says it is closed unpaid does the sale move to `payment_attempt + 1` (under its row lock, only
  while it is still that attempt with the intent set) and the new attempt is charged with key
  `<saleId>:<attempt>`, the same method, bank and amount. Stock and voucher are never touched.
- **Never two live bills.** The new attempt is charged only after the old one is closed; and payment-api's own
  unique index (one live payment per order) refuses a second one whatever pos-api does.
- **Nobody cancels a sale that has the intent.** `applyToSale` answers `stale` for a cancel while
  `payment_renew_at` is set (as it does for a switch to cash); a poll, a check and a repeat of the sale change
  nothing while it is set. Only the cashier's request acts on it.
- **A request that failed takes its intent back** (503, 409). If the close reached payment-api and the answer was
  lost, the bill is closed: the next poll cancels the sale, as for the switch to cash.
- **The job** never renews. It takes back an intent older than `POS_PAYMENT_RECONCILE_AFTER_SECONDS` (the request
  that wrote it is gone); the sale is then judged as any other (a closed bill cancels it, an open one waits). A sale
  that moved to the new attempt and got no bill (the request died before the charge) is charged by a repeat of the
  request, else given up by the job after the usual wait (its key is closed first).
- **Cash and renew exclude each other.** A renew is refused while a switch to cash is asked; a cash request drops
  a renew intent in the transaction that writes its own, so cash wins. A cancel drops both.
- **A sale past attempt 1 is no longer "a cash sale".** Whether the current attempt is the cash of a switch is
  read from the sale's method (`!isOnlineMethod(method) && attempt > 1`).
- **Limit:** `MAX_PAYMENT_ATTEMPTS = 5` bills per sale (409 `attempt_limit`); the switch to cash is not counted
  out by it. **Open owner question**, the value is a placeholder.
- Late money on a closed bill stays payment-api's (unmatched receipt, auto-refund); the SalePayment of a sale past
  attempt 1 lists it under `lateReceipts`, now also while the sale still waits.
- pos-web: "Buat QR baru" / "Buat nomor VA baru" / "Buat link baru" on the waiting screen once the code's time
  is over (`checkoutExpired`) or in its last minute.

## Definition of Done

- `[test]` 2043: a `fake_checkout` method is created and sold: `awaiting_payment` with `checkout.paymentUrl`
  (https); paid → completed; expired → cancelled, stock back; refund works; a non-https URL from payment-api never
  reaches the answer (revert-red); the database check takes `fake_checkout` and refuses an unknown method;
  production / unset `NODE_ENV` still refuse (existing tests).
- `[test]` 2041: late money on a closed bill is listed with its amount, kind, refund status and the sale; a
  refused refund is listed; `needsReview` filters; a cashier and an admin get 403 (revert-red); store B sees none
  of A's rows (revert-red on the tenant: the row's `saleId` is null for another store's sale); no payment id or
  gateway reference in the answer; bad query 422; payment-api down 503; off → `enabled: false`.
- `[test]` 2042: a new bill for the same sale: key `<saleId>:2`, old bill closed at the gateway, stock and voucher
  unchanged, exactly one live payment (revert-red: charge before the close is refused by the order of the calls);
  the new bill paid completes the sale once; money on the old bill is an unmatched receipt and pays nothing.
- `[test]` 2042 replay: the same `{ attempt }` twice (also at once) makes one new bill; a renew of the renewed bill
  with the new attempt makes the third.
- `[test]` 2042 races: the customer paid the old bill first → 409 `already_paid`, completed; a poll, a check and
  the job held after reading the sale never cancel it while the renewal runs (revert-red on the `stale` rule); a
  renew against a switch to cash and against a cancel: one outcome.
- `[test]` 2042 failures: payment-api down → 503, the intent is taken back, the sale still waits on the old bill;
  the charge of the new attempt got no answer → a repeat answers the bill; the job takes a stranded intent back and
  gives up a new attempt that never got a bill.
- `[test]` 2042 who: another cashier 404, a `sales.void` holder may, an agent session may not (guard: the route
  checks `assertPersonAtTill` first), store B 404, a cash sale 409 `not_online`, the limit 409 `attempt_limit`,
  bad body 422.
- `[test]` guard: still no payment-api call inside any transaction of `payments-client/` (the count of
  transactions grows by the two new ones).
- `[test]` pos-web: helpers of the review list and of the renew button (vitest).
- `[cmd]` `npm run lint && npm run typecheck && npm run build`; payment-api and pos-api
  `PGTEST_DB=… PAYTEST_DB=… npx jest --runInBand`; pos-web `vitest`.
- `[qa]` the new screens at 375 and 1024 against the local stack with the fake gateway.
- `[manual]` owner QA; the owner decides the attempt limit.

## Files

- pos-api: `src/db/schema/sales.ts`, migrations `0041_gateway_checkout` and `0042_sale_payment_renew`;
  `src/payments-client/` (`payments.client.ts`, `payment-sync.service.ts`, `sale-payment.service.ts`,
  `sale-payment.controller.ts`, new `payment-review.controller.ts`, `payments.module.ts`), `src/guards.spec.ts`;
  tests in `test/pg-cashier-flow.e2e-spec.ts` (its fake-gateway harness: holds, lost answers, made-up answers).
- pos-web: `src/routes/kasir/-online.ts`, `-online-api.ts`, `-online-pay.tsx`, `src/routes/perlu-ditinjau/`,
  `src/nav.ts`, `src/routes/metode-pembayaran/`; review minors of PR 40 (`kasir/-pin-keys.ts`, `kasir/tutup.tsx`).
- `CLAUDE.md` (pos-api's side).

## Not in this plan

A real provider's checkout (UMK-1977); owner actions on an unmatched receipt beyond what payment-api does itself
(the automatic refund); payment-api pushing status to pos-api.

## Open owner questions

- How many bills one sale may get (`MAX_PAYMENT_ATTEMPTS`, 5 here).
- Whether a `sales.void` holder who is not the sale's cashier should renew (allowed here, like cancel).
