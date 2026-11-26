# payment-api

[← Back to the project README](../../README.md)

The one service that records payments and talks to payment gateways. NestJS 11, Drizzle ORM, its **own** PostgreSQL
database `payment`. Only other services call it ([pos-api](../pos-api/README.md)); never expose it to a browser.

- Every route except `/health` and gateway webhooks needs the header `X-Payment-Service-Key`; the store comes from
  `X-Tenant-Id`.
- Cash, card terminal and static QRIS are recorded without any outside call.
- Real gateway adapters are not included; they wait for a legal review. Only adapters may talk to a gateway.

## Run

Create the database and role once ([`ops/payment-role.sql`](../../ops/payment-role.sql); steps in
[local setup](../../README.md#-run-it-locally)).

```bash
npm run build -w payment-api
```

```bash
DATABASE_URL=postgres://payment_app:<key>@localhost:5544/payment npm run db:migrate -w payment-api
```

```bash
NODE_ENV=development PAYMENT_ADAPTERS=fake DATABASE_URL=postgres://payment_app:<key>@localhost:5544/payment PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w payment-api
```

Port 3001 by default. Optional payment-flow settings are listed in [`.env.example`](../../.env.example).

## Fake gateway

For local work only (`PAYMENT_ADAPTERS=fake` with `NODE_ENV` set to `development` or `test`; anything else fails at
start). Methods `fake_qris` and `fake_va`; bills live in memory. Controls, with the same two headers:

| Route under `/dev/fake-gateway` | Effect |
|---|---|
| `GET payments` | List bills |
| `POST payments/:providerRef/pay` · `fail` · `expire` · `late-pay` · `webhook` | Play the customer or the gateway |
| `POST refunds/:id/succeed` · `fail` | Finish a refund |
| `GET account`, `POST account/approve` · `needs-fix` · `reject` · `suspend` | Store onboarding |

More in the [fake gateway plan](../../docs/plans/2026-11-25-003-feat-umk-1991-fake-gateway-plan.md).

## Main routes

`/payments` (charge, close, sync, cancel, void, refund), `/merchant-accounts` (gateway onboarding),
`/unmatched-receipts` (money that matches no payment), `/webhooks/:provider`, `/internal/tenants/purge`, `/health`.

## Test

```bash
PAYTEST_DB=pay_mine npm test -w payment-api
```

## Libraries

NestJS 11, Drizzle ORM, `postgres`, zod, RxJS; Jest, Supertest, ESLint.
