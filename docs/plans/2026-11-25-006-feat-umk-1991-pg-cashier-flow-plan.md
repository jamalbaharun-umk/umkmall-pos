# UMK-1991: the cashier's PG flow in pos-api (server part)

Date: 2026-11-25. Epic UMK-1924, payment-api UMK-1991. Spec: Claude Doc "Payment-api: alur pembayaran PG dan kasus
tepi" (rev 21) and `qa/05-payment-api-spec-review-and-cases.md`. Builds on plans
[2026-11-24-003](2026-11-24-003-feat-umk-1991-payment-api-plan.md),
[2026-11-24-007](2026-11-24-007-feat-umk-1991-pos-payment-integration-plan.md) and
[2026-11-25-003 fake gateway](2026-11-25-003-feat-umk-1991-fake-gateway-plan.md).

## Goal

A cashier can sell with a payment-gateway (PG) method, dynamic QRIS or VA, end to end against the local fake
gateway (`fake_qris`, `fake_va`), so the owner can QA the whole flow locally. This plan is pos-api only; the pos-web
screens are a separate task that builds on the contract below. The legal lock (UMK-1977) stays: no real PG adapter,
no onboarding, no sub-merchant.

## Decisions

- **An online payment method is configured per store.** `pos.payment_methods` gets a fifth kind `online` with a
  `gateway_method` (`fake_qris` or `fake_va`: `GATEWAY_METHODS` in `db/schema/sales.ts`, a database check, and
  `ONLINE_METHODS` in `payments.client.ts`). Online payments are on only with payment-api on AND `NODE_ENV`
  explicitly `development` or `test` (`loadEnv().onlinePaymentsAllowed`): production and an unset `NODE_ENV` refuse
  them (fails closed; a real provider waits for UMK-1977). That is asked when a method is created (422) and again
  at every sale (422, nothing taken), so a method that exists does not sell where it must not; a method whose
  gateway method this version does not know does not sell either.
- **Attempts.** `sales.payment_attempt` (1, 2, …) is the attempt the sale is being paid with; the charge key is
  `<saleId>:<attempt>`. Only the switch to cash starts a new attempt, and `payment_attempt_at` is when it started
  (the job's wait before it gives an unanswered charge up counts from there). A new QR for the same sale (D12) is not built:
  the cashier cancels and sells again. **Superseded 2026-11-26 (UMK-2042):** a new QR, VA or link for the same sale is built, see plan [2026-11-26-004](2026-11-26-004-feat-umk-1991-review-list-new-qr-checkout-plan.md).
- **Switch to cash is an intent written before anything is closed, and only the cashier's request acts on it.**
  `sales.switch_cash_paid` (the cash tendered) is stored first; then that request closes the PG attempt at
  payment-api (`POST /payments/:id/cancel`, or `POST /payments/close` when no payment has the key), turns the sale
  into a cash sale (method Tunai, cash rounding, attempt + 1) and charges it as `cash`. The PG says the bill was
  paid after all (D5) → the sale completes as the PG sale, the intent is dropped and the request answers 409
  `already_paid`.
  - **A request that got no usable answer takes the intent back** (also when it fails for any other reason) and
    says so (503 `payment_unavailable`, 409 `cancel_refused`): nothing turns the sale into a cash sale later. With
    no answer at all the close may still have reached payment-api, so the 503 does not say "try again": it tells
    the cashier to check the payment status first. Either the bill is still open (the customer can pay the QR, or
    the cashier asks for cash again), or it is closed and the next poll cancels the sale (the cashier sells
    again).
  - **A poll, a check or a repeat of the sale never does the switch**: with an intent present they change
    nothing. They also never cancel a sale that has one.
  - **The job closes nothing for a switch.** It meets an intent only when the request that wrote it is gone, and
    then: the bill is `cancelled` (only the cashier's request closes the bill of a sale with an intent, so it was
    closed for the switch and the request died before the turn) → the job finishes the switch, a cash sale; the
    bill ended by itself (`expired`, `failed`), or no bill ever existed → the job takes the intent back and
    cancels the sale, stock and voucher back; the bill is still open → the job leaves it, and the cashier asks
    again or cancels (a cancel drops the intent first), or the bill expires and the job cancels the sale then. So
    an intent never keeps a sale waiting for ever, and it blocks a shift's close no longer than the bill lives.
  - Once the sale IS a cash sale (attempt 2) the cashier said the cash was received: every worker charges it and
    none gives it up for want of a payment. A cash request that could not record the cash answers 503
    `cash_payment_pending`.
- **An answer is applied only to the sale that was read.** `settle` reads the sale without a lock, asks
  payment-api, then writes under the sale's row lock. That write is refused as stale when the sale has moved to
  another attempt, or when it would cancel a sale whose switch to cash is asked; the sale is then read again. So a
  poll, a check or the job that read the sale before a switch can never cancel it after.
- **A sale counts from when it was paid** (owner ruling 2026-11-25, consistent with shift and drawer timing).
  `sales.paid_at` is the moment every day-based figure (`/reports/*`, the dashboard, profit and loss) and the sales
  list's `from`/`to` and order use, in place of `created_at`; the sale answers `paidAt`. The rule:
  - a sale paid in the request that rang it up (payment-api off, or a cash/EDC/static QRIS sale answered at
    once): that moment;
  - a sale that waited for a payment gateway: payment-api's paid time, kept between the sale's creation and now
    (its clock is not ours); when payment-api gives no time, or one that is not a time, the moment pos-api applies
    the payment. A paid sale is never left waiting over a bad value;
  - a sale switched to cash: the moment the cashier took the cash;
  - a cash/EDC/static QRIS sale whose payment could not be confirmed at once and is completed later (by a repeat
    of the request or by the job): the moment it is completed.
  A QR sale rung up at 23:58 and paid at 00:03 is in the new day. **A day's figures can still grow after the day
  is over:** pos-api learns of a PG payment only by the poll, the check or the job, and dates it at the
  gateway's paid time. A bill paid at 23:59:58 and learned after midnight (or hours later, after an outage) is
  added to yesterday. It is added to the day the customer paid, never moved between days. A shift's figures are by
  shift, as before. The migration dates every earlier sale at its `created_at`.
- **No Idempotency-Key on refund, cancel and close.** Exactly-once rests on payment-api's state machine: a bill is
  closed only while it waits (a second close answers the closed payment), a refund is asked only for a payment
  that is `paid` (pos-api looks first, and payment-api answers the refund under way on a repeat), and the refund's
  key at the PG is payment-api's own `refund_key`.
- **A store that may not charge at the PG gets no bill** (UMK-2019). payment-api refuses the charge with
  `merchant_not_active`, `method_disabled`, `live_disabled` or `merchant_mode_mismatch` and writes no payment.
  pos-api then closes the charge key (`POST /payments/close`) and cancels the sale at once, stock and voucher back,
  and answers 409 with that `code`. Any other refusal still leaves the sale waiting for the job.
- **Owner rulings (2026-11-25).** A switch to cash whose request died is finished by the job only when the bill
  was already closed for it (the rule above); the job closes no bill for a switch. Retry of a refused refund needs
  `sales.void` and no new PIN; marking it "dikembalikan manual" is the owner's alone (the approved spec). Only the sale's own cashier takes
  cash for it. Cancel is allowed for any sale that awaits payment, PG or not. There is no new QR for the same sale:
  the cashier cancels and sells again. **Superseded 2026-11-26 (UMK-2042):** a new QR, VA or link for the same sale is built, see plan [2026-11-26-004](2026-11-26-004-feat-umk-1991-review-list-new-qr-checkout-plan.md).
- **Late PG money** on the closed attempt is payment-api's business: an unmatched receipt, refunded automatically
  (M5, D13). pos-api only shows it (`lateReceipts`).
- **Cancel** of an awaiting sale needs no PIN (V2) and happens only on payment-api's answer (M17): payment-api
  unreachable → 503 and nothing changes.
- **A paid PG sale is cancelled by refund, never by void** (V5). The refund reuses the void record
  (`pos.sale_voids`, `refund_status` = `pending` | `succeeded` | `failed`; null on a plain void): same reasons, same
  PIN approver holding `sales.void`, same reversal of stock, voucher and report figures at once (V3), the money
  counted as returned by transfer (no drawer). The refund is asked at payment-api after the pos commit, like a void,
  and the job repeats it. A refused refund (V4) is retried by an actor holding `sales.void`, and marked
  "dikembalikan manual" by the owner only.
- **Statuses are payment-api's.** pos-api maps `created`/`pending` to `awaiting_payment` and passes the rest on.
  A payment is `expired` only when payment-api says so (after the PG's answer and the grace period);
  `checkoutExpired` tells the screen that the QR's own time is over while that is still open.
- **Who may act.** Reading, checking and cancelling: the sale's own cashier, or a holder of `sales.void` (the
  supervisor who recovers a stuck payment). Not `reports.view`: the answer carries what pays the bill. Paying in
  cash: the sale's own cashier only (the cash goes into that shift's drawer). Refund: started with `sales.create`,
  approved by PIN of a `sales.void` holder (the void rules). Retry: `sales.void`. Manual mark: the owner. Every action
  route is for a person at the till (`assertPersonAtTill`): an agent session uses none of them.

## Endpoints

Every route takes the tenant from the session; another store's id answers 404. Bad input answers 422
`{ message, errors }`. payment-api gave no clear answer → 503 `{ message, code: 'payment_unavailable' }`, and nothing
changed. Money is integer rupiah.

### Payment methods

`POST /payment-methods` (`catalog.manage`) body `{ name, kind: 'cash'|'debit'|'credit'|'wallet'|'online',
gatewayMethod?: 'fake_qris'|'fake_va' }`; `gatewayMethod` is required for `online` and refused otherwise.
Every payment method is answered as `{ id, name, kind, gatewayMethod: string|null }`.

### Start a PG sale

`POST /sales` (unchanged request, `paymentMethodId` an online method, `paid` = total, header `Idempotency-Key`).
201 with the sale as `GET /sales/:id` answers it, `status: 'awaiting_payment'`, plus `payment` (a **SalePayment**,
below). Stock and voucher are taken. A repeat with the same key answers the same sale and the same QR (D10).
PG refused or unreachable (M11) → 409 `{ message, saleId, status: 'cancelled' }`, stock and voucher back.
The store's gateway account is not active or the method is off → the same 409 with `code`
(`merchant_not_active` | `method_disabled` | `live_disabled` | `merchant_mode_mismatch`).

`GET /sales/:id` and each row of `GET /sales` also carry `onlinePayment: boolean`.

### SalePayment

```jsonc
{
  "saleId": "uuid", "saleNumber": 12,
  "saleStatus": "awaiting_payment",       // awaiting_payment | completed | void | cancelled
  "status": "awaiting_payment",           // awaiting_payment | paid | expired | failed | cancelled
                                          // | refund_pending | refunded | refund_failed | voided
  "online": true,                         // the sale's current method is a PG method
  "method": "fake_qris",                  // payment-api's method of the current attempt; null = none
  "paymentMethodId": "uuid", "paymentMethodName": "QRIS",
  "amount": 5123, "attempt": 1,
  "checkout": { "qrString": "…" },        // or { "bank": "…", "vaNumber": "…" }; null unless awaiting a PG payment
  "expiresAt": "ISO|null",                // when the QR or VA stops (15 minutes)
  "checkoutExpired": false,               // expiresAt has passed and the payment is still open
  "lastCheckedAt": "ISO|null",            // when payment-api last asked the PG
  "canCloseAtGateway": true,              // false: the QR stays payable until expiresAt even after a cancel (D13)
  "switchingToCash": false,               // a switch to cash was asked and is not finished
  "refund": null,                         // or { status: pending|succeeded|failed, sent: boolean, reasonCode,
                                          //      note, requestedAt }
  "lateReceipts": [                       // PG money that paid no sale (M5); payment-api refunds it
    { "id": "uuid", "attempt": 1, "amount": 5123, "kind": "late_payment", "refundStatus": "refunded",
      "needsReview": false }              // kind: late_payment | duplicate | amount_mismatch;
  ]                                       // refundStatus: none | pending | refunded | failed
}
```

### Status

- `GET /sales/:id/payment` (signed in; own sale or `sales.void`) → 200 SalePayment. The poll (every 3 s): reads
  payment-api's stored status, asks no PG, and applies the answer (completes or cancels the sale).
- `POST /sales/:id/payment/check` (`sales.create`) → 200 SalePayment. "Cek status pembayaran": payment-api asks the
  PG (at most once per 5 s per payment), then as above. Recovers a lost webhook.

### Switch to cash

`POST /sales/:id/payment/cash` (`sales.create`, own sale) body `{ paid }` (cash tendered, at least the total rounded
up to Rp100) → 200 SalePayment with `saleStatus: 'completed'`, `method: 'cash'`. A repeat answers the same.
409 `{ code }`: `already_paid` (the customer paid the QR; the sale is completed as a PG sale, give the cash back),
`not_awaiting` (the sale is cancelled or was never waiting), `not_online` (nothing to switch from), `not_own_sale`,
`cancel_refused` (payment-api would not close the bill; the sale still waits), `payment_refused` (the sale is a cash
sale already and payment-api refused to record its cash).
503 `{ code }`: `payment_unavailable` (the switch did NOT happen and was taken back; the message tells the cashier
to check the payment status first, because the bill may already be closed, in which case the sale is cancelled
and must be rung up again), `cash_payment_pending` (the sale IS a cash sale now, its cash is not recorded yet: repeat the
request, or the job records it).

### Cancel

`POST /sales/:id/payment/cancel` (`sales.create`; own sale or `sales.void`), no body, no PIN → 200 SalePayment
with `saleStatus: 'cancelled'`; stock and voucher back. A repeat answers the same. 409 `already_paid` (completed
instead), `not_awaiting` (a receipt: void or refund it), `cancel_refused`. It works for any sale that awaits
payment, also a cash one whose charge never got an answer.

### Refund

- `POST /sales/:id/refund` (`sales.create`, header `Idempotency-Key`) body `{ reasonCode, note?, approverId, pin }`
  (the void's body) → 201 with the void record as `GET /sales/:id/void` answers it, plus `refundStatus`. The sale
  becomes `void`. 409 `use_void` on a sale that was not paid through a PG; `POST /sales/:id/void` on a PG sale
  answers 409 `use_refund`; both refusals come before the PIN is checked. PIN errors as for a void (422 on a
  wrong PIN, 429 when the approver is locked). A repeat with the same key answers the same record.
- `POST /sales/:id/refund/retry` (`sales.void`), no body → 200 void record. Asks a refused refund again; a refund
  that is pending or done is answered as it stands.
- `POST /sales/:id/refund/manual` (the owner only; anyone else 403) body `{ note }` → 200 void record with `refundStatus: 'succeeded'`.
  Only for a refused refund (409 `not_refund_failed` otherwise); the mark asks payment-api where the refund stands
  first.
- Refund status: `refund.status` of `GET /sales/:id/payment`, and `refundStatus` of `GET /sales/:id/void`.

## Definition of Done

- [test] An online method needs a gateway method, payment-api on and `NODE_ENV` explicitly development or test; a
  kasbon instalment cannot be paid with one. With `NODE_ENV=production` and with it unset: creation 422, and a
  sale with a method that exists 422 with nothing taken. An unknown gateway method is refused by the database
  check, and a row that has one does not sell.
- [test] A stale answer never cancels a sale switched to cash: a poll, a check and the job, each held after
  reading the sale, against a switch held (a) with the bill just closed and (b) with the cash not yet recorded
  (revert-red once).
- [test] A switch that got 503 is taken back: poll, check and job leave the sale a PG sale, and the customer's QR
  payment completes it with no cash. The close reached payment-api but its answer was lost: the sale is cancelled.
  A switch whose request died is finished by the job only when the bill was closed for it.
- [test] Two workers at once: cancel and switch, cancel and the customer's payment, checks and the job on a paid
  bill, refund retries and the job, a refund's request and the job: one outcome, nothing twice. A refund that
  succeeded is not overwritten by an older answer.
- [test] Report day: a PG sale rung up yesterday and paid today is in today's report and list and not in
  yesterday's; its refund reverses today; a sale switched to cash counts from the switch; a sale paid at once
  counts from when it was rung up; a paid PG sale whose paid time is missing or is no time is completed and counts
  from now (never a 500, never left waiting); a cash sale completed by the job the next day counts from that day;
  the migration's backfill statement dates an earlier sale at `created_at`.
- [test] Guard: every action route on a sale's payment and every refund route checks the session kind first
  (`assertPersonAtTill`; revert-red once).
- [test] A PG sale answers `awaiting_payment` with `qrString` (QRIS) or `bank` + `vaNumber` (VA), `expiresAt` 15
  minutes ahead, charge key `<saleId>:1`, stock and voucher taken; a repeat makes no second sale or bill (D10).
- [test] Paid through the fake webhook: the poll completes the sale once; the shift's cash is untouched.
- [test] Expired and failed bills cancel the sale with stock and voucher back; a failed charge (M11) answers 409.
- [test] A store whose gateway account is not active: 409 with `code`, the sale cancelled at once, no bill, the
  charge key closed; a repeat answers the same cancelled sale.
- [test] Lost webhook (M1): the poll still says waiting, the manual check completes the sale.
- [test] Switch to cash with the QR open (D5, D13): one cash payment `<saleId>:2` for the rounded amount, the drawer
  holds it, the sale is completed once; PG money that arrives later is an unmatched receipt refunded once (M5) and the
  sale is not paid twice. The customer paid first → 409 `already_paid`, completed as the PG sale.
- [test] Cancel: no PIN, no void row (V2), stock back; refused with 503 while payment-api is down (M17).
- [test] Refund success, and refund refused then retried (V3, V4, D9); marked returned by hand; one refund at the PG.
- [test] Void on a PG sale and refund on a CASHAC sale are refused with no PIN attempt spent (V5).
- [test] Repeats of every action are idempotent.
- [test] Cross-tenant: store B gets 404 on store A's sale for every new route, and nothing of A changes.
- [test] Permissions: a cashier without `sales.void` cannot retry a refund, and only the owner marks one returned
  by hand (a `sales.void` holder gets 403); another cashier cannot read,
  cancel or cash another cashier's sale, also with `reports.view`; one with `sales.void` can read and cancel it.
- [test] The shift does not close while a PG sale awaits payment.
- [test] A stranded switch: the bill failed, or never existed → poll and check change nothing, the job takes the
  switch back and cancels the sale; no cash payment, stock back.
- [test] The job leaves an open PG sale waiting, records the cash of a sale already switched, sends a refund that
  could not be sent and follows a pending refund.
- [test] Guard: no payment-api call inside any transaction of `payments-client/` (revert-red once).
- [cmd] `npm run lint && npm run typecheck && npm run build`;
  `PGTEST_DB=… PAYTEST_DB=… npx jest --runInBand` in `apps/pos-api`.
- [qa] pos-web screens against this contract (separate task).
- [manual] Owner QA with the fake gateway's controls (`/dev/fake-gateway/…`).

## Files

- `apps/pos-api/src/db/schema/sales.ts`, `voids.ts`, `payment-sync.ts`, migrations `pg_cashier_flow` and
  `pg_cashier_flow_review` (the gateway-method check; the job's index on `payment_attempt_at`) and `sale_paid_at`.
- `apps/pos-api/src/reports/reports.service.ts` (day figures by `paid_at`).
- `apps/pos-api/src/payments-client/`: `payments.client.ts` (sync, cancel, refund, manual refund, list by order),
  `payment-sync.service.ts` (attempts, the switch, refunds, the job), new `sale-payment.service.ts` and
  `sale-payment.controller.ts`, `payments.module.ts`.
- `apps/pos-api/src/sales/` (online sale, `cash.ts`), `src/void/` (refund), `src/payment-methods/`,
  `src/receivables/` (refusal), `src/guards.spec.ts`.
- `apps/pos-api/test/pg-cashier-flow.e2e-spec.ts`, `test/support/payment-api.ts` (fake adapter, clock).
- `CLAUDE.md` (pos-api's side).

## Trying it locally

1. payment-api with the fake gateway: `NODE_ENV=development PAYMENT_ADAPTERS=fake PAYMENT_SERVICE_KEY=<key>` (and its
   `DATABASE_URL`), port 3001.
2. pos-api with `PAYMENT_API_URL=http://localhost:3001 PAYMENT_SERVICE_KEY=<the same key>`.
3. The store's gateway account must be active with the method on: onboard it under "Pembayaran Online" (plan
   2026-11-25-004 pg-onboarding). The tests seed it (`apps/payment-api/test/support/merchants.ts`).
4. As the owner: `POST /payment-methods { "name": "QRIS", "kind": "online", "gatewayMethod": "fake_qris" }` (and
   `fake_va`). Until pos-web has the screens, the routes above are called directly.
5. The customer and the gateway are played with payment-api's controls (plan 2026-11-25-003), headers
   `X-Payment-Service-Key` and `X-Tenant-Id: <the store's tenant id>`: `GET /dev/fake-gateway/payments` lists the
   bills (`providerRef`, `orderRef` = the sale id), `POST /dev/fake-gateway/payments/<providerRef>/pay` pays one
   (`{ "webhook": "drop" }` loses the webhook), `/fail`, `/expire`, `/late-pay`;
   `POST /dev/fake-gateway/settings { "refundMode": "pending" | "succeed" | "fail" }` and
   `POST /dev/fake-gateway/refunds/<refund id>/succeed` settle a refund.
5. An expired bill closes the sale only after payment-api's grace period (`PAYMENT_EXPIRY_GRACE_SECONDS`, default 10
   minutes; set it to 0 to see it at once), on a check or on payment-api's reconciliation.

## Not in this plan

Real PG adapters, onboarding, sub-merchant; a new QR for the same sale (D12); the owner's "Perlu ditinjau" list and
the "uang pelanggan belum dikembalikan" report line (V8); payment-api pushing status to pos-api (outbox delivery):
pos-api learns of a payment by the poll, the manual check and the job.
