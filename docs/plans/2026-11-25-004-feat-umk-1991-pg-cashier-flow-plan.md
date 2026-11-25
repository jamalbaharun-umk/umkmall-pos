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
  `gateway_method` (`fake_qris` or `fake_va`, the list is `ONLINE_METHODS` in `payments.client.ts`). Creating one is
  refused (422) while payment-api is off, and when `NODE_ENV=production`: a real provider waits for UMK-1977.
- **Attempts.** `sales.payment_attempt` (1, 2, …) is the attempt the sale is being paid with; the charge key is
  `<saleId>:<attempt>`. Only the switch to cash starts a new attempt, and `payment_attempt_at` is when it started
  (the job's wait before it gives an unanswered charge up counts from there). A new QR for the same sale (D12) is not built:
  the cashier cancels and sells again.
- **Switch to cash is an intent written before anything is closed.** `sales.switch_cash_paid` (the cash tendered)
  is stored first; then the PG attempt is closed at payment-api (`POST /payments/:id/cancel`, or
  `POST /payments/close` when no payment has the key). Any worker (the request, a status poll, the job) that then
  finds the attempt closed unpaid turns the sale into a cash sale (method Tunai, cash rounding, attempt + 1) instead
  of cancelling it, and charges it as `cash`. The PG says the bill was paid after all (D5) → the sale completes as
  the PG sale, the intent is dropped and the request answers 409 `already_paid`. A switch left unfinished therefore
  completes as cash, because the cashier said the cash was received (the M15 reasoning).
- **Late PG money** on the closed attempt is payment-api's business: an unmatched receipt, refunded automatically
  (M5, D13). pos-api only shows it (`lateReceipts`).
- **Cancel** of an awaiting sale needs no PIN (V2) and happens only on payment-api's answer (M17): payment-api
  unreachable → 503 and nothing changes.
- **A paid PG sale is cancelled by refund, never by void** (V5). The refund reuses the void record
  (`pos.sale_voids`, `refund_status` = `pending` | `succeeded` | `failed`; null on a plain void): same reasons, same
  PIN approver holding `sales.void`, same reversal of stock, voucher and report figures at once (V3), the money
  counted as returned by transfer (no drawer). The refund is asked at payment-api after the pos commit, like a void,
  and the job repeats it. A refused refund (V4) is retried or marked "dikembalikan manual" by an actor holding
  `sales.void`.
- **Statuses are payment-api's.** pos-api maps `created`/`pending` to `awaiting_payment` and passes the rest on.
  A payment is `expired` only when payment-api says so (after the PG's answer and the grace period);
  `checkoutExpired` tells the screen that the QR's own time is over while that is still open.
- **Who may act.** Reading, checking and cancelling: the sale's own cashier, or `reports.view`. Paying in cash: the
  sale's own cashier only (the cash goes into that shift's drawer). Refund: started with `sales.create`, approved by
  PIN of a `sales.void` holder (the void rules). Retry and manual mark: `sales.void`.

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

- `GET /sales/:id/payment` (signed in; own sale or `reports.view`) → 200 SalePayment. The poll (every 3 s): reads
  payment-api's stored status, asks no PG, and applies the answer (completes or cancels the sale).
- `POST /sales/:id/payment/check` (`sales.create`) → 200 SalePayment. "Cek status pembayaran": payment-api asks the
  PG (at most once per 5 s per payment), then as above. Recovers a lost webhook.

### Switch to cash

`POST /sales/:id/payment/cash` (`sales.create`, own sale) body `{ paid }` (cash tendered, at least the total rounded
up to Rp100) → 200 SalePayment with `saleStatus: 'completed'`, `method: 'cash'`. A repeat answers the same.
409 `{ code }`: `already_paid` (the customer paid the QR; the sale is completed as a PG sale, give the cash back),
`not_awaiting` (the sale is cancelled or was never waiting), `not_online` (nothing to switch from), `not_own_sale`,
`cancel_refused` (payment-api would not close the bill; the sale still waits).

### Cancel

`POST /sales/:id/payment/cancel` (`sales.create`; own sale or `reports.view`), no body, no PIN → 200 SalePayment
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
- `POST /sales/:id/refund/manual` (`sales.void`) body `{ note }` → 200 void record with `refundStatus: 'succeeded'`.
  Only for a refused refund (409 `not_refund_failed` otherwise).
- Refund status: `refund.status` of `GET /sales/:id/payment`, and `refundStatus` of `GET /sales/:id/void`.

## Definition of Done

- [test] An online method needs a gateway method, payment-api on and a non-production environment; a kasbon
  instalment cannot be paid with one.
- [test] A PG sale answers `awaiting_payment` with `qrString` (QRIS) or `bank` + `vaNumber` (VA), `expiresAt` 15
  minutes ahead, charge key `<saleId>:1`, stock and voucher taken; a repeat makes no second sale or bill (D10).
- [test] Paid through the fake webhook: the poll completes the sale once; the shift's cash is untouched.
- [test] Expired and failed bills cancel the sale with stock and voucher back; a failed charge (M11) answers 409.
- [test] Lost webhook (M1): the poll still says waiting, the manual check completes the sale.
- [test] Switch to cash with the QR open (D5, D13): one cash payment `<saleId>:2` for the rounded amount, the drawer
  holds it, the sale is completed once; PG money that arrives later is an unmatched receipt refunded once (M5) and the
  sale is not paid twice. The customer paid first → 409 `already_paid`, completed as the PG sale.
- [test] Cancel: no PIN, no void row (V2), stock back; refused with 503 while payment-api is down (M17).
- [test] Refund success, and refund refused then retried (V3, V4, D9); marked returned by hand; one refund at the PG.
- [test] Void on a PG sale and refund on a CASHAC sale are refused with no PIN attempt spent (V5).
- [test] Repeats of every action are idempotent.
- [test] Cross-tenant: store B gets 404 on store A's sale for every new route, and nothing of A changes.
- [test] Permissions: a cashier without `sales.void` cannot retry or mark a refund; another cashier cannot read,
  cancel or cash another cashier's sale.
- [test] The shift does not close while a PG sale awaits payment.
- [test] The job leaves an open PG sale waiting, finishes a switch left half done, sends a refund that could not be
  sent and follows a pending refund.
- [test] Guard: no payment-api call inside any transaction of `payments-client/` (revert-red once).
- [cmd] `npm run lint && npm run typecheck && npm run build`;
  `PGTEST_DB=… PAYTEST_DB=… npx jest --runInBand` in `apps/pos-api`.
- [qa] pos-web screens against this contract (separate task).
- [manual] Owner QA with the fake gateway's controls (`/dev/fake-gateway/…`).

## Files

- `apps/pos-api/src/db/schema/sales.ts`, `voids.ts`, `payment-sync.ts`, one migration `pg_cashier_flow`.
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
3. As the owner: `POST /payment-methods { "name": "QRIS", "kind": "online", "gatewayMethod": "fake_qris" }` (and
   `fake_va`). Until pos-web has the screens, the routes above are called directly.
4. The customer and the gateway are played with payment-api's controls (plan 2026-11-25-003), headers
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
