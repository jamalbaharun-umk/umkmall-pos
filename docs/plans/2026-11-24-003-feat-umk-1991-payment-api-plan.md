# UMK-1991 — payment-api, a separate gateway-agnostic payment service

Linear: **UMK-1991**. Owner decisions 24 Nov 2026: a separate app from the start, one adapter contract per payment
gateway (PG), CASHAC is cancelled by void and PG payments by refund, one payment method per order, full void or
refund only.

## Breakdown

UMK-1991 is delivered in five parts. **This plan covers parts 1 and 2 and the payment-api half of part 5.** It does
not touch `apps/pos-api`.

1. App scaffold, own database and role, schema (this plan).
2. Adapter contract, CASHAC adapters, charge / read / cancel API (this plan).
3. pos-api sale flow in two steps (pending sale → charge → complete). Later.
4. Reconciliation job in pos-api for a sale left pending. Later; this plan ships the lookups it needs.
5. Store purge: the endpoint in payment-api (this plan); the call from pos-api's purge. Later.

## Goal

`apps/payment-api` is the one service that records payments and, later, talks to a PG. Other services call it
server to server to charge, read, void or refund. It has its own Postgres database (`payment`), its own role
(`payment_app`), its own test database and its own deploy. Its contract speaks of an **order reference**, never of a
sale or a shift, so UMKMall main can use it later.

## Contract

Every route except `GET /health` needs both headers:

- `X-Payment-Service-Key`: compared in constant time to env `PAYMENT_SERVICE_KEY`. Wrong or missing → 401.
- `X-Tenant-Id`: a uuid set by the calling service from its own session. Read only after the key check passed.
  Missing or not a uuid → 400. A tenant id in body, query or path is never read.

Errors are `{ message, code?, errors? }` in English (the caller is a service; pos-api owns the Indonesian copy).
`code` is stable and safe to branch on. Bad input → 422 with `errors` per field. Nothing internal is echoed.

| Route | Behaviour |
| --- | --- |
| `POST /payments` + `Idempotency-Key` | Body `{ orderRef, method, amount, actorRef }`. Creates and charges. 201 with the payment. A retry with the same key and the same body answers 200 with the first payment; the same key with another body → 409 `idempotency_key_reused`. A second live (pending or paid) payment for the same `orderRef` → 409 `order_already_paid`. Unknown method → 422. |
| `GET /payments/:id` | The payment with its audit events. 404 for another tenant's id. |
| `GET /payments?orderRef=&idempotencyKey=&status=&page=&perPage=` | Tenant's payments, newest first, any filter combination. For reconciliation. |
| `POST /payments/:id/sync` | For a `pending` payment: asks the adapter (`getStatus`) and stores the answer. Other statuses are returned unchanged. |
| `POST /payments/:id/cancel` | Body `{ reason, actorRef, approvedBy }`. payment-api picks: void when the adapter supports void, else refund when it supports refund, else 409 `cancel_not_supported`. |
| `POST /payments/:id/void` | Same body. 409 `void_not_supported` when the adapter cannot void (a PG payment). |
| `POST /payments/:id/refund` | Same body. 409 `refund_not_supported` when the adapter cannot refund (CASHAC). |
| `POST /internal/tenants/purge` | Deletes every row of the tenant in `X-Tenant-Id`. `{ purged: true }` when rows were deleted, `{ purged: false }` otherwise. Idempotent. |

Cancel rules:

- `reason`, `actorRef` and `approvedBy` are all required (422 without). `approvedBy` is the supervisor reference the
  caller asserts: the owner requires an admin or supervisor PIN for void and refund. pos-api verifies the PIN;
  payment-api only requires and stores the reference.
- Only a `paid` payment is cancelled. `pending`, `failed`, `expired` → 409 `not_cancellable`.
- A retry on a payment already voided (or refunded) by the same operation returns it unchanged with no second audit
  row and no second adapter call.
- The row is locked (`select … for update`) for the whole cancel, so two concurrent cancels produce one.
- Full amount only. There is no amount field.

## Adapters

One contract, `PaymentAdapter` (`src/adapters/adapter.ts`): `method`, `kind` (`cashac` | `online`), `supportsVoid`,
`supportsRefund`, and `charge`, `getStatus`, `void`, `refund`, `handleWebhook`. Adapters are provided as one list
(`PAYMENT_ADAPTERS`); the registry maps `method` → adapter. Adding a PG adds one adapter to the list; no caller
and no route changes.

Shipped: `cash`, `edc_debit`, `static_qris`, all CASHAC: `charge` answers `paid` at once, void is
supported, refund is not, and nothing calls out of the process. Kasbon is not a payment method (stage 2): the
caller keeps the receivable, and each instalment is its own payment.

No PG adapter ships before the legal gate (UMK-1977). A scriptable fake `online` adapter lives in `test/support/`
and proves the PG flow (stage 2 below, which replaces this section's first version where they differ).

## Data

Database `payment`, schema `payment`, role `payment_app` (`ops/payment-role.sql`). Every table has `tenant_id`
(a plain uuid: the tenant lives in another database, so there is no foreign key) and RLS enabled.

- `payments`: `tenant_id`, `order_ref`, `method`, `amount` (integer rupiah, `bigint`, check ≥ 0), `status`
  (`pending`, `paid`, `failed`, `expired`, `voided`, `refunded`), `idempotency_key`, `request_hash`, `provider_ref`,
  timestamps. Unique `(tenant_id, idempotency_key)`. Partial unique `(tenant_id, order_ref)` where status is
  `pending` or `paid`: one live payment per order (no split payment).
- `payment_events`: the audit trail. `tenant_id`, `payment_id`, `type` (`charged`, `voided`, `refunded`),
  `actor_ref`, `approved_by`, `reason`, `created_at`.

## Definition of Done

- [test] Charge with each CASHAC method creates one `paid` payment and a `charged` audit row; a retry with the same
  idempotency key answers the first payment and creates no second row; the same key with another body → 409.
- [test] The same idempotency key under two tenants creates two payments (unique per tenant).
- [test] A second live payment for the same order reference → 409; after a void the order can be charged again.
- [test] Amount: a float, a numeric string, a negative → 422. Missing or malformed `Idempotency-Key` → 422.
- [test] Void of a CASHAC payment marks it `voided` with no outbound call (`fetch` spied) and writes the audit row
  (actor, approvedBy, reason, time). Refund on a CASHAC payment → 409 `refund_not_supported`. Void on the
  refund-only adapter → 409 `void_not_supported`. `cancel` picks void for CASHAC and refund for the fake online.
- [test] Cancel without `reason`, `actorRef` or `approvedBy` → 422 and the payment stays `paid`.
- [test] A repeated void changes nothing and adds no audit row; a `pending` payment cannot be cancelled.
- [test] `sync` moves the fake online payment from `pending` to `paid`; refund then calls the adapter once.
- [test] Service key: wrong, missing, empty → 401 on every route; `/health` stays public. Tenant header missing or
  not a uuid → 400. A `tenantId` in body or query is ignored.
- [test] Cross-tenant: store B gets 404 on store A's payment for read, sync, cancel, void and refund, and does not
  see it in lists; A's payment is unchanged.
- [test] Lookup by `orderRef`, by `idempotencyKey` and by `status`; paging.
- [test] Purge deletes every row of one tenant in every tenant table (each had rows before), leaves another tenant
  untouched, and a second call answers `purged: false`. Guard: every table in schema `payment` except the
  migrations journal has `tenant_id` (revert-red once with a table without it).
- [test] Schema: RLS on every table; the migrations journal is in `payment`; `payment_app` cannot create a schema.
- [test] Source guards: no `console`; no tenant id from body, query or params; the service key and the tenant header
  are read only in `src/auth/service.guard.ts`; no `fetch`/`http` import under `src/` (revert-red once).
- [cmd] In `apps/payment-api`: `npm run lint`, `npm run typecheck`, `npx jest --runInBand`, `npm run build`. At the
  root: `npm run lint && npm run typecheck`.
- [manual] Not exercised here: the Docker image build, a deploy, the pos-api caller, a real PG.

## Files

- `apps/payment-api/`: `package.json`, `Dockerfile`, tsconfig, eslint, nest and drizzle config;
  `src/{main,config,app.module}.ts`, `src/auth/` (service guard, decorators), `src/common/` (error filter,
  validation), `src/db/` (module, migrate, schema), `src/adapters/` (contract, CASHAC adapters, registry),
  `src/payments/` (schemas, service, controller), `src/purge/`, `src/health/`, `src/guards.spec.ts`,
  `drizzle/0000_*.sql`.
- Tests: `test/support/{env,global-setup,fixtures,fake-online.adapter}.ts`, `test/payments.e2e-spec.ts`,
  `test/cancel.e2e-spec.ts`, `test/auth.e2e-spec.ts`, `test/purge.e2e-spec.ts`, `test/db.e2e-spec.ts`.
- `ops/payment-role.sql`, `.env.example`, `turbo.json` (`PAYTEST_DB`), `commitlint.config.js` (scope
  `payment-api`), `CLAUDE.md` (payment-api section).

## Stage 2 — PG flow and edge cases

Source: the design doc "Payment-api: alur pembayaran PG dan kasus tepi" (final revision, 24 Nov 2026) and the QA
review. Where it differs from the sections above (statuses, cancel body, kasbon, the fake adapter, test files), this
section wins. Still no real PG adapter (UMK-1977): the flow is proven with `test/support/fake-gateway.ts`.

### Rules built

1. One live payment per `(tenant, orderRef)`: partial unique index for `created`, `pending`, `paid`.
2. The row is written as `created` and committed before the PG is called.
3. Our payment id is the PG reference and the charge idempotency key. A refund's key is `payments.refund_key`,
   set when the payment moves to `refund_pending`: one key for as long as that refund is under way, a new key for
   a retry after a refusal. It is never derived from the audit trail.
4. The caller's `Idempotency-Key` is the order reference plus the attempt number; the body carries `attempt`
   (default 1). Unique `(tenant, orderRef, attempt)`. A new attempt is accepted only once the previous payment is
   closed; an old key always answers its old payment.
5. One `settle` function (`src/payments/settlement.service.ts`) used by webhook, manual sync and reconciliation. It
   locks the row (`select … for update`), asks the adapter, and moves the status at most once.
6. Statuses move forward only, by rank (`src/payments/transitions.ts`): `created` 0, `pending` 1, `failed` /
   `expired` / `cancelled` 2, `paid` 3, `refund_pending` 4, `refunded` / `refund_failed` / `voided` 5. The one
   backward move is `refund_failed` → `refund_pending`. A closed unpaid payment never becomes `paid`.
   `needs_review` is a flag with a reason, not a status.
7. Money that matches no open payment is never dropped and never changes a closed payment: it becomes an
   `unmatched_receipts` row (`late`, `duplicate` or `amount_mismatch`), flagged for review and, when
   `PAYMENT_LATE_AUTO_REFUND` is on, refunded by actor `system`. Settling never fails on the unique index.
8. A webhook is never trusted: signature first (401), then status and exact amount are fetched again from the PG.
9. Webhook inbox `webhook_events`, unique `(provider, event_id)`, stored before processing. An unknown reference is
   kept as `unmatched`. A failed processing is retried with a growing delay and parked, with an alert log line,
   after `PAYMENT_WEBHOOK_MAX_ATTEMPTS`.
10. The tenant of a webhook or a reconciliation sweep comes from our payment row, never from the payload.
11. A `created` payment becomes `failed` only after two "no such bill" answers at least
    `PAYMENT_NOT_FOUND_CONFIRM_SECONDS` apart, or at once when the PG was certainly never reached. A `pending`
    payment the PG no longer knows closes the same way, flagged `missing_at_gateway`. A "found" answer in between
    resets the count.
14. No payment waits for ever. The PG says paid in another amount: a single-use bill is `failed` at once
    (`amount_mismatch`); a reusable one, or a "paid" with no receipt, is `expired` after the bill's expiry plus the
    grace period. Cancel always reaches `cancelled` unless a receipt for the exact amount exists; a cancel while
    the PG says paid with no receipt yet is flagged `paid_without_receipt`. The environment is refused at boot
    when `PAYMENT_LATE_SWEEP_SECONDS` is below `PAYMENT_EXPIRY_GRACE_SECONDS`.
15. A receipt whose amount is not a whole, safe integer never pays and is never refunded by the system: the payment
    is flagged `invalid_gateway_amount`.
16. A debt paid in instalments (kasbon) is one order reference per instalment, `<receivableId>:<n>`, set by the
    caller. The one-live-payment rule then protects each instalment from a double charge.
12. An adapter declares `supportsVoid`, `supportsRefund`, `canCancel` and `singleUseQr`, and reports each receipt as
    the gross amount with the fee apart.
13. A paid CASHAC payment is never voided automatically.

Every status change writes, in the same transaction, one `payment_events` audit row and one `outbox` row (the notice
for the caller). **The outbox dispatcher is not built** (it needs pos-api's endpoint).

### Routes added or changed

- `POST /payments` body: `{ orderRef, method, amount, attempt?, actorRef }`. Codes: `idempotency_key_reused`,
  `attempt_already_used`, `order_has_live_payment`.
- `POST /payments/:id/cancel`: `paid` → void or refund by adapter capability. `created` / `pending` → the cashier may
  cancel at any time: the bill is closed at the PG when the adapter can (`canCancel`), then its status is asked;
  paid there → 409 `already_paid` and the payment becomes `paid`; else `cancelled`. An adapter that cannot close a
  bill: cancelled anyway when `PAYMENT_CANCEL_WITHOUT_GATEWAY_CLOSE` is on (later money is an unmatched receipt),
  else 409 `cancel_not_supported` with the expiry time. A PG that takes the cancel and leaves the bill open: the
  same switch decides between `cancelled` and 503 `gateway_unavailable`.
- Void and refund body: `{ reasonCode, note?, actorRef, approvedBy }`. `reasonCode` is one of `wrong_item_or_qty`,
  `wrong_payment_method`, `customer_cancelled`, `duplicate_transaction`, `goods_returned`, `other` (`note` required).
- Refund: `paid` → `refund_pending` (committed) → adapter → `refunded`, stays `refund_pending`, or `refund_failed`
  with `needs_review`. A `refund_failed` payment can be refunded again.
- `POST /payments/:id/refund/manual` `{ note, actorRef, approvedBy }`: `refund_failed` → `refunded` (the owner
  returned the money by hand). Off → 409 `manual_refund_disabled`.
- `POST /webhooks/:provider`: no service key; authenticated by the adapter's signature check.
- `GET /payments?needsReview=true`, `GET /unmatched-receipts?needsReview=true`.
- Purge answers 409 `payments_in_flight` while the tenant has a `created`, `pending` or `refund_pending` payment, or
  a `refund_failed` one younger than `PAYMENT_PURGE_FAILED_REFUND_BLOCK_DAYS`.
- `ReconciliationService.tick()` on a timer: settles payments in flight older than the threshold, expires bills
  past expiry plus the grace period, retries inbox events. It also keeps asking about closed payments
  (`cancelled`, `expired`, `failed`) until the bill's expiry plus `PAYMENT_LATE_SWEEP_SECONDS` (default one hour),
  so late money whose webhook was lost is found and refunded. Longest unasked first.

- `POST /payments/close` + `Idempotency-Key` (added with the pos-api integration, plan 007): the charge's own key and
  body. No payment under the key → a `cancelled` one is written under it (201), claiming the key and the attempt, so
  a charge that arrives later answers it and never pays. A payment under the key → answered unchanged (200), also a
  `paid` one. For a caller that gives up on a charge whose answer it never got.

### Configurable

Env names and defaults are in `src/config.ts` and `.env.example`. Owner decisions: late money is refunded
automatically; a QR lives 15 minutes; a refused refund can be marked returned by hand, with a note; a failed refund
blocks the purge for 30 days. Still a proposal: the 10-minute grace before the automatic `expired`.

### Definition of Done (stage 2)

- [test] Each edge-case code has at least one test whose name carries it: D1–D7, D9–D13, M1–M15, M18–M20, M22,
  V1–V5, V9. Not mapped (caller behaviour or not built): D8, M16, M17, M21, V6, V7, V8. Partly: M4 (the outbox row
  is written; nothing delivers it).
- [test] Race: webhook, manual sync and reconciliation at once for one payment → one transition, one audit row,
  one outbox row. Revert-red once by removing the row lock in `settle`.
- [test] Transition table: unit test over every pair of statuses.
- [cmd] The same gate as stage 1.

### Not built, follow-ups

- The outbox dispatcher; the daily matching against the PG's settlement report; an endpoint to resolve a
  `needs_review` flag or a failed refund of an unmatched receipt.
- pos-api: the two-step sale, sale cancel ordering (M16), refusing a shift close while a sale awaits payment (M17),
  and the supervisor PIN check.

From the review of 24 Nov 2026 (tracked, not built):

- Refund of an unmatched receipt that the PG refused: a retry and a "returned by hand" route, as payments have.
- PG calls inside a database transaction (`settle`, `executeRefund`, `executeReceiptRefund`, cancel): a slow PG
  holds a row lock and a connection. Move the call outside, keeping the lock only for the write.
- The purge leaves webhook events that were never matched to a payment (no tenant on the row). Give them a
  retention period, or match them before the purge.
- A purge safeguard flag (as pos-api's `POS_PURGE_ENABLED`), so the endpoint is off until the caller's checks exist.
- A bill the PG keeps reporting `pending` after its expiry is closed only by a cancel, never on our clock alone.
- The sweep of closed payments has no index of its own (it filters on status and expiry). Add a partial index
  when volume asks for it.
- Head-of-line blocking in the sweep: a payment whose lookup keeps failing never gets a new `lastSyncedAt`, so it
  stays first in the "longest unasked first" order and can crowd out others at the limit. Record the last attempt
  apart from the last answer.
- Cancel can answer 200 with a payment still `pending` when the only receipt for the exact amount has an invalid
  fee amount: the receipt is set aside as an adapter fault and nothing pays or closes the payment in that call.
- A `pending` bill the PG no longer knows is failed after the same confirmation time as a `created` one (60 s).
  A bill the PG once confirmed may deserve a longer one, with its own setting.
- Money that arrives on a closed bill after the late sweep ended is found only by a webhook or by the daily
  matching (not built).

## Open points for the owner

- payment-api cannot check that an account is erasable (it does not share UMKMall's database). The purge trusts the
  caller; pos-api must call it only from its own purge, after its own 409 check.
- Tax and bookkeeping law may require payment records to be kept after a store is erased. The purge deletes them,
  as pos-api's does.
- A zero-rupiah payment is accepted (an order fully covered by a voucher still gets one payment record).
- Kasbon instalments use one order reference per instalment (`<receivableId>:<n>`, rule 16). To list a
  receivable's payments the caller asks per instalment; a prefix filter on `orderRef` can be added if needed.
- A single-use QR paid in another amount fails the payment at once and the money is refunded; the cashier charges
  again with a new attempt. Confirm this is the wanted cashier flow.

