# UMK-1991: a fake payment gateway for local use

Epic UMK-1924, payment-api (UMK-1991). Asked by the owner through the QA thread on 2026-11-25. This plan covers
`apps/payment-api` only.

## Goal
On a developer's or QA's machine, payment-api can run every payment gateway (PG) flow without a PG: a dynamic
QRIS or a virtual account (VA) bill is created, and a person decides what happens to it: paid, failed, expired,
paid late, paid twice, refunded or refund refused, with the webhook delivered, lost or delivered twice. Nothing
here is a real PG adapter (that stays behind the legal gate, UMK-1977) and none of it can load in production.

## Design
- **One adapter family, `fake`.** `src/adapters/fake/local-fake-gateway.ts` holds a small in-process gateway
  (`LocalFakeGateway`) and two adapters of the one contract (`src/adapters/adapter.ts`): methods `fake_qris`
  (dynamic QRIS, single use) and `fake_va` (virtual account, can be paid twice), both `kind: 'online'`,
  `provider: 'fake'`, `supportsRefund: true`, `supportsVoid: false`, `canCancel: true`. The bill's validity is
  the payment's `expiresAt`, which payment-api sets from `PAYMENT_QR_TTL_SECONDS` (default 900 = 15 minutes).
- **Listed, never default.** New env `PAYMENT_ADAPTERS`: a comma list of extra adapters, default empty. The
  only name is `fake`; another name is a boot error. The three CASHAC adapters always ship. With `fake`
  listed, the adapters join the `PAYMENT_ADAPTERS` provider and the control routes are mounted; without it
  neither exists (the routes answer 404).
- **Never in production, two locks.** `loadEnv` refuses `PAYMENT_ADAPTERS=fake` with `NODE_ENV=production`
  (`Invalid environment: PAYMENT_ADAPTERS`, before the app is created), and `LocalFakeGateway`'s constructor
  throws on its own unless `NODE_ENV` is `development` or `test` (fails closed: production and unset are refused). The Dockerfile sets `NODE_ENV=production`.
- **No outbound call; state in memory.** The guard "nothing under `src/` calls out" stays as it is. The
  gateway keeps its bills in a `Map` in the process, not in a table: a table would put a fake's schema in
  the production database, and would need RLS, a tenant column and purge cover for data that is never real.
  The cost: a restart of payment-api forgets the bills, and a payment still waiting then closes as `failed`
  by the existing "no such bill on two lookups" rule. That is acceptable for a local tool and is stated in
  the usage section.
- **The webhook runs the real path, in process.** A control action builds the notification the PG would
  POST (`{ eventId, reference }`), signs it (HMAC-SHA256, header `X-Fake-Signature`, a secret drawn at boot)
  and hands it to `WebhooksService.receive('fake', { headers, rawBody })`: the same call
  `POST /webhooks/fake` makes. So the adapter's signature check, the inbox (`webhook_events`, once per event
  id), `settle` and the transition table all run. It is not sent over HTTP because that would be an outbound
  call from `src/`. Every control answer carries the signed notification (`body`, `signature`), so a person
  (and the e2e tests) can also POST it to `POST /webhooks/fake` over HTTP: later, twice, or out of order.
- **Settlement is not touched.** The controls only change what the fake gateway knows (bill status,
  receipts, refunds). payment-api learns it the usual way: webhook, manual sync or reconciliation, each
  through `SettlementService.settle`. No control writes a payment row.
- **Controls are a calling-service route group.** `src/adapters/fake/fake-gateway.controller.ts`, under
  `/dev/fake-gateway`, behind the global `ServiceGuard` (service key, then `X-Tenant-Id`). A control sees
  only the bills of the header's tenant; another tenant's `providerRef` or refund id answers 404. Bodies are
  validated with zod (422).
- **Scripted behaviour at creation, by amount.** `PaymentRef` carries no metadata, so a hint in the charge
  body would change the contract; the last three digits of the amount do it instead (table below).

### Control routes
All need `X-Payment-Service-Key` and `X-Tenant-Id`. `webhook` is `send` (default), `drop` (the notification
is built and returned, not delivered) or `duplicate` (delivered twice with one event id).

| Route | Body | Does |
| --- | --- | --- |
| `GET /dev/fake-gateway/payments` | | `{ items: Bill[] }`, the tenant's bills, newest first |
| `POST …/payments/:providerRef/pay` | `{ amount?, webhook? }` | a receipt on an open bill (`amount` defaults to the bill's; another amount is the mismatch case; a paid `fake_va` takes a second payment, a paid `fake_qris` answers 409 `already_paid`) |
| `POST …/payments/:providerRef/fail` | `{ webhook? }` | the open bill is failed |
| `POST …/payments/:providerRef/expire` | `{ webhook? }` | the open bill is expired now |
| `POST …/payments/:providerRef/late-pay` | `{ amount?, webhook? }` | a receipt on a closed bill (409 `bill_open` while it is open) |
| `POST …/payments/:providerRef/webhook` | `{ eventId? }` | sends a notification for the bill; with an earlier `eventId`, the same event again |
| `POST /dev/fake-gateway/refunds/:id/succeed` | `{ webhook? }` | a pending refund succeeds (`:id` is the refund's id in the bill) |
| `POST /dev/fake-gateway/refunds/:id/fail` | `{ webhook? }` | a pending refund is refused |
| `GET /dev/fake-gateway/settings` | | `{ refundMode }` |
| `POST /dev/fake-gateway/settings` | `{ refundMode }` | how a new refund is answered: `pending` (default, a person settles it), `succeed`, `fail` |

Every POST on a bill or a refund answers 200 with `{ bill: Bill, webhook: Notification | null }`:

```
Bill         { providerRef, paymentId, orderRef, method, amount, status, expiresAt, checkout,
               receipts: [{ id, amount, paidAt }], refunds: [{ id, receiptId, amount, status }], createdAt }
             status: pending | paid | failed | expired | cancelled   (the gateway's view, not payment-api's)
Notification { eventId, body, signature, signatureHeader: "X-Fake-Signature", delivered,
               answers: [{ received, duplicate }] }
```

Refusals: 404 `not_found`, 409 `bill_closed` (pay, fail or expire on a closed bill), `already_paid`,
`bill_open`, `refund_not_pending`, 422 for a bad body.

### Scripted amounts (`amount % 1000`)
| Ends in | At the charge |
| --- | --- |
| `901` | the gateway refuses: the payment is `failed` |
| `902` | the gateway is unreachable: `failed` (certainly no bill) |
| `903` | the bill is created and the answer is lost: payment-api finds it by reference, `pending` |
| `911`–`919` | the answer takes 1–9 seconds |

## Definition of Done
- [test] `fake_qris` and `fake_va` charge to `pending` with a checkout (`qrString`, `vaNumber`) and an
  `expiresAt` 15 minutes on; the bill is listed for its tenant.
- [test] Paid by webhook: `pay` → `paid`, audit source `webhook`, one `webhook_events` row `processed`.
- [test] The same over HTTP: `pay` with `webhook: drop`, then the returned body and signature POSTed to
  `/webhooks/fake` with no service key and no tenant header → `paid`; a wrong signature → 401. The stored
  event's tenant is the payment row's (the notification names no tenant).
- [test] Failed: `fail` → `failed`. Expired: `expire` leaves the payment `pending` inside the grace period,
  `expired` after it; a bill nobody touches expires by the reconciliation alone.
- [test] Late payment: bill cancelled, `late-pay` → payment stays `cancelled`, one `late_payment` unmatched
  receipt, refund asked by `system` (`PAYMENT_LATE_AUTO_REFUND` on), `refunds/:id/succeed` → `refunded`;
  with the flag off the receipt waits `needs_review` and no refund is asked.
- [test] Refund: success → `refunded`; refused → `refund_failed` (needs review), asked again → a new refund
  id at the gateway → `refunded`.
- [test] Lost webhook: recovered by `POST /payments/:id/sync` (source `sync`) and by the reconciliation
  tick (source `reconciliation`).
- [test] Duplicate webhook: one `paid` move, one outbox notice, the second delivery answers `duplicate`.
  Out of order: an old notification delivered after the refund changes nothing.
- [test] Amount mismatch on a QR and a second payment on a VA become unmatched receipts.
- [test] Scripted amounts 901, 902, 903 and 911.
- [test] Every control route answers 401 without the service key and 400 without the tenant header.
- [test] Cross-tenant: store B gets 404 on store A's `providerRef` (pay, fail, expire, late-pay, webhook) and
  refund id (succeed, fail), and does not see A's bills.
- [test] Not listed: the control routes answer 404 and `fake_qris` is an unknown method (422).
- [test] Production: `loadEnv` refuses, the gateway's constructor refuses, and the app does not boot.
- [test] Revert-red, once each: the production refusal (both locks) and the guard on the control routes.
- [cmd] In `apps/payment-api`: `PAYTEST_DB=pay_fakepg npx jest --runInBand`. Root: `npm run lint && npm run
  typecheck && npm run build`.
- [manual] Not done here: a run against a started `nest start` with curl, and anything from the cashier
  (pos-api cannot start a PG payment, see Follow-ups).

## Files
- `apps/payment-api/src/adapters/fake/local-fake-gateway.ts` (new): the gateway and the two adapters.
- `apps/payment-api/src/adapters/fake/fake-gateway.controller.ts` (new): control routes, their service and
  module.
- `apps/payment-api/src/adapters/adapters.module.ts`: the gateway provider (null unless listed) and the
  adapter list. `src/config.ts`: `PAYMENT_ADAPTERS`. `src/app.module.ts`: one conditional import.
  `src/payments/payments.controller.ts`: export `WebhooksService`.
- `.env.example`, `CLAUDE.md` (payment-api section).

## Tests to add
- `apps/payment-api/test/fake-gateway.e2e-spec.ts` (the real app with `PAYMENT_ADAPTERS=fake`, a fake clock).
- `apps/payment-api/src/adapters/fake/local-fake-gateway.spec.ts` (constructor refusal), `src/config.spec.ts`
  (`PAYMENT_ADAPTERS`), `test/auth.e2e-spec.ts` (not mounted, unknown method when not listed).

## Usage (local QA)
Environment of payment-api, on top of `DATABASE_URL` and `PAYMENT_SERVICE_KEY`:

```bash
PAYMENT_ADAPTERS=fake              # mounts fake_qris, fake_va and /dev/fake-gateway; needs NODE_ENV=development or test (production and unset are refused)
# optional, to see expiry without waiting 25 minutes (defaults: 900 and 600):
PAYMENT_QR_TTL_SECONDS=60
PAYMENT_EXPIRY_GRACE_SECONDS=0
```

```bash
API=http://localhost:3001
H=(-H "X-Payment-Service-Key: $PAYMENT_SERVICE_KEY" -H "X-Tenant-Id: $TENANT" -H "Content-Type: application/json")

# 1. A dynamic QRIS bill (use "fake_va" for a virtual account). The answer has id, providerRef and checkout.
curl -s "${H[@]}" -H "Idempotency-Key: order-1:1" -X POST $API/payments \
  -d '{"orderRef":"order-1","attempt":1,"method":"fake_qris","amount":25000,"actorRef":"qa"}'

# 2. What the gateway holds for this store.
curl -s "${H[@]}" $API/dev/fake-gateway/payments

# 3. The payer pays (webhook delivered). Or: fail, expire.
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/pay
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/fail
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/expire

# 4. A lost webhook: pay without delivering, then recover by a manual check (or wait for the reconciliation:
#    PAYMENT_RECONCILE_AFTER_SECONDS + PAYMENT_RECONCILE_INTERVAL_SECONDS, 3 minutes by default).
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/pay -d '{"webhook":"drop"}'
curl -s "${H[@]}" -X POST $API/payments/$PAYMENT_ID/sync
#    The dropped notification can still be delivered by hand, as a PG would (no service key):
curl -s -X POST $API/webhooks/fake -H "Content-Type: application/json" \
  -H "X-Fake-Signature: $SIGNATURE" --data-raw "$BODY"

# 5. A duplicate webhook, and the same event again later.
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/pay -d '{"webhook":"duplicate"}'
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/webhook -d "{\"eventId\":\"$EVENT_ID\"}"

# 6. Late money: close the bill (cancel, or let it expire), then pay it. The payment stays closed, the money
#    is an unmatched receipt (GET /unmatched-receipts) and, with PAYMENT_LATE_AUTO_REFUND on, a refund is asked.
curl -s "${H[@]}" -X POST $API/payments/$PAYMENT_ID/cancel -d '{"actorRef":"qa"}'
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/payments/$PROVIDER_REF/late-pay

# 7. Refunds wait at the gateway until a person settles them (refunds[].id in the bill).
curl -s "${H[@]}" -X POST $API/payments/$PAYMENT_ID/refund \
  -d '{"reasonCode":"customer_cancelled","actorRef":"qa","approvedBy":"supervisor"}'
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/refunds/$REFUND_ID/succeed
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/refunds/$REFUND_ID/fail
#    Or let every new refund answer at once:
curl -s "${H[@]}" -X POST $API/dev/fake-gateway/settings -d '{"refundMode":"succeed"}'
```

Things to know:
- `late-pay` on a bill that payment-api still holds open (expired at the gateway, inside
  `PAYMENT_EXPIRY_GRACE_SECONDS`) pays the payment: that is the "payment on its way" rule, not a fault. For
  the unmatched path the payment must be `cancelled`, `expired` or `failed` first.
- `expire` closes the bill at the gateway at once; payment-api shows `expired` only once its own
  `expiresAt` plus the grace has passed (set both low, as above, to see it quickly).
- The bills live in memory: a restart of payment-api forgets them, and a payment still waiting then closes
  as `failed` after two lookups (`PAYMENT_NOT_FOUND_CONFIRM_SECONDS`).
- `X-Tenant-Id` is the store's tenant uuid (`pos.tenants.id`), the one pos-api sends.

## Follow-ups (not in this change)
- **pos-api cannot start a PG payment.** Its client knows `cash`, `edc_debit` and `static_qris` only
  (`apps/pos-api/src/payments-client/payments.client.ts`), a sale is charged and expected `paid` in one
  answer, and the cashier has no screen that shows a QR or a VA number and waits. So the fake gateway is
  driven through payment-api's API (curl), not from the cashier. Building that is M5, behind the legal gate
  (UMK-1977).
- The fake's method names (`fake_qris`, `fake_va`) are its own; a real PG adapter brings its own names.
