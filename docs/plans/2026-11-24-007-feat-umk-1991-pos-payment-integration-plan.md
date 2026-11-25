# UMK-1991 — pos-api calls payment-api (parts 3, 4 and the pos-api half of 5)

Linear: **UMK-1991**. Earlier parts: [2026-11-24-003](2026-11-24-003-feat-umk-1991-payment-api-plan.md) (the service
itself). Spec: "Payment-api: alur pembayaran PG dan kasus tepi" (final, 24 Nov 2026), QA cases in
`qa/05-payment-api-spec-review-and-cases.md`. Server only: no screen changes, no PG adapter, no QR flow.

## Goal

Every payment pos-api takes is recorded in payment-api, for the CASHAC methods that exist today: cash (`cash`),
debit (`edc_debit`) and wallet / the store's own QRIS (`static_qris`). A sale is made in two steps (create as
`awaiting_payment`, charge, complete), a void also voids the payment, kasbon payments are payments of their own, a
job finishes what a request left behind, and the store purge also empties the store's rows in payment-api.

## The switch

`PAYMENT_API_URL` unset → **payment-api is off**: pos-api behaves exactly as before this change (a sale completes
in one step, nothing is sent, `sales.payment_id` stays null). This keeps local development and every existing test
working without a second service. Set → `PAYMENT_SERVICE_KEY` (≥ 16 chars) is required too, or pos-api refuses to
boot. There is no in-process stub: the integration tests start the real `apps/payment-api` Nest app in-process on
its own database.

A row made while payment-api was off is never sent later: a sale without `payment_id`, a kasbon payment without
`seq`. Their void makes no payment-api call.

## Model

1. **Client** (`src/payments-client/payments.client.ts`): the only file that reads the service key and writes the
   `X-Payment-Service-Key` and `X-Tenant-Id` headers (guard test). Every method takes the tenant id as its first
   argument; callers pass `session.tenantId` or, in the job and the purge, the tenant of our own row. Timeout
   `PAYMENT_API_TIMEOUT_MS` (default 5000), `redirect: 'error'`. An answer that is not a clear yes or no (network
   error, timeout, 5xx, 401, 400) is `unavailable`; a 404/409/422 is `rejected` with payment-api's `code`. Nothing is
   logged but the route and the status.
2. **No call to payment-api inside a database transaction or under a row lock** (guard test; the purge is the one
   exception, below). Each unit of work reads its pos row, asks payment-api, then writes. Two workers on one row are
   safe because payment-api decides: charge and void are idempotent there, and a charge and a close of one key
   race on its unique index, so both workers are given the same payment.
3. **Sale, two steps** (cash, debit, wallet):
   - Step 1, one transaction, as today (shift lock, prices, voucher quota, stock, receipt number) but the sale is
     written as `awaiting_payment`, with payment-api's method fixed on the row (`payment_method_code`).
   - Step 2: charge `{ orderRef: <sale id>, attempt: 1, method, amount, actorRef }` with `Idempotency-Key:
     <sale id>:1`. `amount` is what the customer owes: for cash `total + rounding` (UMK-1993), else `total`. Then a
     short transaction locks the sale and applies the answer only if the sale still awaits payment: `paid` → `completed`
     with `payment_id`; a closed, unpaid payment → `cancelled`, stock and voucher quota back. The payment must be this
     sale's, for this amount, on both paths. `unavailable` or `rejected` → nothing changes, the request answers 503.
   - A retry with the same `Idempotency-Key` runs step 2 again (D1, D2, M12). A retry on a cancelled sale answers 409.
   - A cancelled sale is never completed (M16).
4. **Hidden until final.** `awaiting_payment` and `cancelled` sales are in no list, report, shift total or expected
   cash (`FINAL_SALE_STATUSES`, guard test). `GET /sales?status=awaiting_payment` lists the waiting ones (M17).
5. **Shift close** answers 409 while a sale of that shift is `awaiting_payment`, naming the receipt numbers.
6. **Void.** The pos void is unchanged (PIN, one transaction) and refuses a sale that is not `completed`. It sets
   `sale_voids.payment_sync_pending`; after the commit pos-api calls `POST /payments/:id/void` with the void's
   `reasonCode`, `note`, `actorRef` and `approvedBy` (the PIN-verified approver). A failed call leaves the flag set
   and the job repeats it.
7. **Kasbon.** The credit sale completes in one step and has no payment (M22). Its down payment and every instalment
   is a payment with `orderRef = <receivableId>:<n>` (`receivable_payments.seq`), recorded **after** the pos
   transaction commits; a failed call leaves `payment_id` null for the job. A void of the kasbon sale records any
   payment not yet recorded, then voids each (V7).
8. **Job** (`PaymentSync.tick`, every `POS_PAYMENT_RECONCILE_INTERVAL_SECONDS`, default 60, 0 = off). It never
   rejects and never crashes the process; it stops at the first `unavailable` answer.
   - A sale `awaiting_payment` for longer than `POS_PAYMENT_RECONCILE_AFTER_SECONDS` (default 120, refused at boot
     below twice the client timeout): look the payment up by its key. `paid` → complete (M4, M15: never an automatic
     void). Closed and unpaid → cancel. **No payment → close the key first, then cancel on that answer** (next point).
   - Kasbon payments not yet recorded; voids not yet recorded.
   - The sweep reads across stores; each row is then handled with the tenant id of that row.
9. **A sale is cancelled only on a payment that payment-api says is closed** (spec: cancel only after a confirmed
   final status). "No payment found" is not that: a charge of ours that timed out here may still commit there. So
   payment-api has `POST /payments/close` (same key and body as the charge): with no payment under the key it writes a
   `cancelled` one, claiming the key in the same transaction; with one, it answers it unchanged. A late charge then
   answers the cancelled payment and can never be paid; if the charge won the race, the close answers `paid` and the
   sale is completed. The waiting time only gives the cashier time to retry; it is no longer what makes this safe.
10. **Refusals are counted and parked.** A row payment-api (or the identity check) keeps refusing gets a
    `pos.payment_sync_issues` row; after `POS_PAYMENT_SYNC_MAX_ATTEMPTS` (10) it is parked: no longer swept, logged
    as an error with its row id, listed by `GET /payment-sync/issues` (`reports.view`) and released by
    `POST /payment-sync/issues/:id/retry` (`sales.void`). `unavailable` answers are never counted.
11. **Turning payment-api off:** pos-api refuses to start with `PAYMENT_API_URL` unset while a sale is
    `awaiting_payment` (it could never be completed or cancelled, and would block its shift).
12. **Purge.** Inside the purge transaction, under the "account is being deleted" lock, after every pos delete and just
    before the commit, pos-api calls payment-api's purge with the store's tenant id. A failure (unreachable, or 409
    `payments_in_flight`) rolls every pos delete back and answers 503, so UMKMall retries. So a failed pos delete never
    leaves a living store without its payments. The remaining window is a commit that fails after payment-api
    purged (the retry then finds the store and nothing in payment-api). After the commit the purge is called once
    more, for a payment the job recorded in between.

## Definition of Done

- [test] A cash sale creates one `paid` payment: `orderRef` = sale id, key `<sale id>:1`, amount = the rounded
  amount due; the sale is `completed` with that `payment_id`. A retry with the same `Idempotency-Key` returns the
  same sale and creates no second payment (D1, D2). Debit → `edc_debit` and wallet → `static_qris`, exact total.
- [test] The tenant comes from the session: a client `X-Tenant-Id` header is ignored, a `tenantId` in the body is
  422; the payment row carries the session's tenant. With a wrong service key payment-api answers 401, the sale
  stays `awaiting_payment`, no payment exists.
- [test] Cross-tenant: store B gets 404 voiding store A's sale and A's payment stays `paid`; the client asking for
  A's payment as B gets "not found".
- [test] payment-api down: 503, the sale is `awaiting_payment` with stock and voucher quota taken, hidden from the
  list and the shift total, shift close 409 with the receipt number (M17). Retry when it is back completes it (M12).
- [test] Job: charge succeeded but the answer was lost → the job completes the sale, one payment, no void, a second
  tick changes nothing (M4, M15, D8). No payment after the waiting time → the job cancels: stock and quota back,
  shift closes, retry answers 409. A payment closed unpaid → cancelled. A cancelled sale is never completed (M16).
- [test] Void: the payment becomes `voided` with reason, actor and approver; a repeated void makes no second audit
  row (V1). Void while payment-api is down succeeds in pos and the job voids the payment later.
- [test] Kasbon (M22, V7): no payment for the sale; down payment `<receivableId>:1`, instalment `<receivableId>:2`;
  an instalment taken while payment-api is down is recorded by the job; the void voids both.
- [test] Purge removes the store's rows in the payment database and leaves another store's; payment-api down → 503
  and the pos rows are intact.
- [test] Guards: the service key and both headers only in `payments-client/payments.client.ts`; no client call
  inside the one transaction of `payment-sync.service.ts`; aggregates use `FINAL_SALE_STATUSES` (revert-red once
  each for the first two). Env: `PAYMENT_API_URL` without `PAYMENT_SERVICE_KEY`, a non-https URL in production and
  a waiting time below twice the timeout are refused; an empty `PAYMENT_API_URL` means off.
- [test] B1: a charge that times out here and reaches payment-api after the job gave the sale up answers the
  cancelled payment: no paid payment for a cancelled sale. The same charge landing first is found and completed. A
  lost close answer cancels nothing until the next tick. Revert-red: cancel without the close → red.
- [test] The cashier's retry and the job at the same instant: one payment, completed exactly when paid.
- [test] One tick over two stores records each row under its own tenant.
- [test] M4: a payment that does not fit its sale is refused, counted, parked after the limit, no longer swept,
  listed for the owner, hidden from another store (retry 404), and completed after a release.
- [test] M3: boot is refused with payment-api off while a sale awaits payment. M1: the timer completes a sale,
  stops with the app, and a tick resolves when the database is gone.
- [test] End of the suite: no sale awaits payment; paid sale payments = completed sales, one to one; no cancelled
  sale has a paid payment.
- [test] payment-api `POST /payments/close`: writes `cancelled` under a free key, a later charge answers it; a paid
  key is answered unchanged; close and charge at once leave one payment; per tenant; needs the service key.
- [test] The existing pos-api suite passes unchanged with payment-api off.
- [cmd] Root `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=… npm test -w pos-api`;
  `PAYTEST_DB=… npx jest --runInBand` in `apps/payment-api`.
- [manual] Not exercised: two deployed services talking over a real network, the timer in a running process,
  pos-web against an `awaiting_payment` sale.

## Files

- `apps/pos-api/src/payments-client/`: `payments.client.ts` (client, errors), `payment-sync.service.ts` (step 2,
  kasbon recording, void recording, the job, parking), `payment-sync.controller.ts` (issues),
  `payments.module.ts` (global), `payments.client.spec.ts`.
- `apps/payment-api`: `POST /payments/close` (`payments.controller.ts`, `payments.service.ts`), `test/close.e2e-spec.ts`.
- `src/config.ts` (env), `src/app.module.ts` (one line), `src/db/schema/{sales,receivables,voids,payment-sync}.ts`,
  `drizzle/0022_payment_sync.sql`.
- `src/sales/` (two steps, `status` filter), `src/shifts/shifts.service.ts`, `src/reports/reports.service.ts`
  (final sales only), `src/void/void.service.ts`, `src/receivables/receivables.controller.ts`, `src/purge/`.
- Tests: `test/payments-integration.e2e-spec.ts`, `test/support/payment-api.ts` (the real payment-api app on its
  own database, `<PAYTEST_DB or payment_test>_pos`, so it never shares one with payment-api's own suite),
  `src/guards.spec.ts`.
- `CLAUDE.md`, `.env.example`.

## Differences from the spec, on purpose

- **The receipt number is given in step 1**, not at completion: a cancelled sale leaves a gap in the numbers.
  Giving it at completion makes `sales.number` nullable in every list, report and screen.
- **Kasbon payments and voids are recorded after the pos commit** (pos first, then payment-api, repeated by the
  job), not charge-first. For CASHAC the charge cannot be refused for a business reason, so the two always
  converge. A PG method for an instalment or a refund-style cancel needs the two-step form.
- **A cancelled sale's stock goes back as `sale_void` movements**, the reason a void uses (no new movement reason).
- **A sale with no payment is cancelled on a payment-api `close`**, a route this change adds to payment-api (the
  spec has no such call; it is how "cancel only on a confirmed final status" is kept when the charge never arrived).
- **No outbox consumer.** payment-api's outbox dispatcher does not exist; pos-api's job polls instead.

## Release risks (tracked, not built)

- **M5: no escape hatch at shift close while payment-api is down.** A sale that awaits payment cannot be voided,
  cancelled or completed until payment-api answers, and its shift cannot close (spec M17, owner decision). The cashier
  action to check or cancel a waiting sale, and its screens, must ship with or before `PAYMENT_API_URL` is set in
  production. Until then the only way out is payment-api coming back (the job then finishes within the waiting time).
- **The receipt-number gap** (a cancelled sale keeps its number) needs the owner's yes before production.
- pos-web has no screen for a 503 on Bayar, a waiting sale, or the parked list.

## Follow-ups (not built)

- A cashier action to check or cancel a waiting sale now (`POST /sales/:id/payment/sync`, cancel), and the screens:
  waiting list with age, the 503 message, shift-close message.
- Receipt number at completion; a new attempt (`attempt` 2…) on the same sale after a closed payment (D12). Today
  attempt is always 1 and a new try is a new sale.
- PG methods: `pending` handling, polling, QR screen, refund path, the outbox endpoint (D8 by payment id).
- Two-step kasbon instalments. A screen for `GET /payment-sync/issues`.
- Require `PAYMENT_API_URL` in production once payment-api is deployed; an owner view of rows not yet recorded.
- Sending history made while payment-api was off, if the owner wants it.
