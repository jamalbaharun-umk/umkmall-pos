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

Shipped: `cash`, `edc_debit`, `static_qris`, `kasbon`, all CASHAC: `charge` answers `paid` at once, void is
supported, refund is not, and nothing calls out of the process. `kasbon` is `paid` from the payment service's view
(the order is settled by credit); the receivable stays in pos-api.

No PG adapter ships before the legal gate (UMK-1977). A fake `online` adapter (refund only, charge answers
`pending`) lives in `test/support/` and proves the refusal rules and the pending → paid → refunded path.
No webhook route ships: `handleWebhook` is in the contract only; the route and its authentication come with the
first PG adapter.

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

## Open points for the owner

- payment-api cannot check that an account is erasable (it does not share UMKMall's database). The purge trusts the
  caller; pos-api must call it only from its own purge, after its own 409 check.
- Tax and bookkeeping law may require payment records to be kept after a store is erased. The purge deletes them,
  as pos-api's does.
- A zero-rupiah payment is accepted (an order fully covered by a voucher still gets one payment record).
