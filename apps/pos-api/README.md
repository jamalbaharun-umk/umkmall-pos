# pos-api

[← Back to the project README](../../README.md)

The business API of UMKMall POS: NestJS 11, Drizzle ORM, PostgreSQL (schema `pos`), zod validation. Used by
[pos-web](../pos-web/README.md); records payments in [payment-api](../payment-api/README.md).

## Run

```bash
npm run build -w pos-api
```

```bash
DATABASE_URL=postgres://pos_app:<key>@localhost:5544/pos npm run db:migrate -w pos-api
```

Then build and start it with the variables below ([full local setup](../../README.md#-installation)):

```bash
npm run build -w pos-api
NODE_ENV=development DATABASE_URL=... POS_SESSION_SECRET=... UMKMALL_WEB_URL=... POS_SERVICE_KEY=... npm run start -w pos-api
```

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | The `pos_app` role (created once by [`ops/pos-role.sql`](../../ops/pos-role.sql)) |
| `POS_SESSION_SECRET` | At least 32 characters; signs POS sessions |
| `UMKMALL_WEB_URL` | Owner sign-in asks `/api/auth/me` there |
| `POS_SERVICE_KEY` | Authenticates the tenant purge call |
| `POS_AGENT_SERVICE_KEY` | Optional, at least 32 characters, never the purge key. UMKMall's agent backend sends it on `POST /auth/agent/session` ([agent integration](../../docs/agent-integration.md)); unset = no agent sessions |
| `NODE_ENV` | `production` in production. `development` or `test` explicitly for the dev sign-in routes (unset refuses them) |
| `PAYMENT_API_URL`, `PAYMENT_SERVICE_KEY` | Optional. Without the URL, payments are not sent and sales finish in one step |
| `POS_TRUSTED_PROXIES` | Number of proxy hops in front, for device-pairing limits |
| `POS_STORAGE_DIR`, `PORT` | Image storage folder, port (default 3000) |

See [`.env.example`](../../.env.example) for the rest.

## Modules

| Folder in `src/` | Main routes |
|---|---|
| `auth`, `tenancy` | `/auth/*`, `/tenant/me` |
| `staff` | `/staff`, `/roles`, `/staff/devices`, `/auth/pin` |
| `catalog`, `stock` | `/catalog/categories`, `/catalog/products`, `/stock/*` |
| `suppliers`, `purchasing`, `stock-opname` | `/suppliers`, `/purchasing/orders`, `/stock-opnames` |
| `sales`, `shifts`, `void` | `/sales`, `/shifts`, `/sales/:id/void`, `/sales/:id/refund`, `/void-pin` |
| `members`, `vouchers`, `receivables` | `/members`, `/vouchers`, `/receivables` |
| `payment-methods`, `payments-client` | `/payment-methods`, `/online-payments`, `/sales/:id/payment`, `/payment-sync/issues` |
| `store-cash`, `expenses`, `reports`, `store` | `/store-cash`, `/expenses`, `/reports/*`, `/store/profile` |
| `purge` | `/internal/tenants/purge` |
| `agent` | `/mcp`, `/agent/activity`, `/agent/access*` (UMKMall's agent, MCP) |

## Test

Needs Postgres (`npm run db:up`). Use your own test database name if others run tests at the same time.

```bash
PGTEST_DB=pos_mine npm test -w pos-api
```

## Rules

The tenant comes from the session only; money is integer rupiah; the server computes prices; invalid input answers 422;
actions are gated by permissions. The full list is in [CLAUDE.md](../../CLAUDE.md).

## Libraries

NestJS 11, Drizzle ORM, `postgres`, zod, `jose`, RxJS; Jest, Supertest, ESLint.
