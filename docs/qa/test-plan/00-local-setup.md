# Local test setup (umkmall-pos)

Written 2026-11-24 from the repo state. Anything marked **TBD (not in repo yet)** is not in the repo; do not assume it exists.
Sources: `CLAUDE.md`, `README.md`, `.env.example`, `docker-compose.yml`, root and app `package.json`, `turbo.json`,
`apps/pos-api/test/support/*.ts`, `ops/*.sql`, and the pos-api and pos-web source named below.

## 0. What is where

| Path | What | Port |
|---|---|---|
| `apps/pos-api` | NestJS 11, Drizzle, Postgres schema `pos` | `PORT`, default 3000 |
| `apps/pos-web` | TanStack Start + Vite + Tailwind 4 | 3101 (hard-coded in `package.json` script) |
| `apps/payment-api` | **Not present** (checked 2026-11-24). Being built. | TBD (not in repo yet) |
| `ops/` | `pos-role.sql` (pos_app role), `local-public-users.sql` (local/CI stub of UMKMall `public.users`) | Postgres 16 on 5544 (`docker-compose.yml`) |

## 1. Prerequisites

- Node.js **>= 22** (`engines` in root `package.json`; CI uses 22), npm 10.9.8, Git, Docker with Compose v2.

## 2. Install and start Postgres

```bash
npm install            # repo root, once
npm run db:up          # docker compose up -d --wait postgres
docker compose ps      # postgres should be healthy
```

Container: `localhost:5544`, user and password `pos`, database `pos`. `pos` is the container superuser.

## 3. Environment variables (names and local values)

Config is read from `process.env` only (`apps/pos-api/src/config.ts`); no dotenv is installed. **Export the variables in your shell**
or pass them inline. A `.env` file is never loaded.

| Variable | Service | Local value | Notes |
|---|---|---|---|
| `DATABASE_URL` | pos-api | `postgres://pos_app:<key>@localhost:5544/pos` | The `pos_app` role. The key is the one you set in section 4. |
| `POS_SESSION_SECRET` | pos-api | 32+ random chars | The POS's own key. Never UMKMall's. |
| `POS_SERVICE_KEY` | pos-api | 16+ random chars | Only for `POST /internal/tenants/purge`. |
| `UMKMALL_WEB_URL` | pos-api | `http://127.0.0.1:9099` (your stub, section 9) | Root `.env.example` shows `https://umkmall.id`. Locally, point at a stub. |
| `POS_STORAGE_DIR` | pos-api | optional, default `.storage` | Relative to the process cwd. Holds product images. Gitignored. |
| `PORT` | pos-api | optional, default 3000 | Use your own port (section 6). |
| `NODE_ENV` | pos-api | optional, default `development` | `production` disables dev sign-in (404). |
| `POS_API_URL` | pos-web | `http://localhost:3000` (or your pos-api port) | Where server functions call pos-api. |
| `UMKMALL_WEB_URL` | pos-web | unset locally | Unset means the POS sign-in page is shown instead of UMKMall's login. |
| `POS_WEB_URL` | pos-web | `http://localhost:3101` | This app's public origin. |
| `POS_DEV_USER_ID` | pos-web | a `public.users` id (section 7) | Enables the "Masuk (pengembangan)" button. Local only. |

Test-only variables (read by `apps/pos-api/test/support/env.ts`; all optional):

| Variable | Default | Notes |
|---|---|---|
| `PGTEST_DB` | `pos` | Your own database per session, for example `pos_qa`. Lower-case identifier. |
| `PGTEST_HOST` | `localhost:5544` | |
| `PGTEST_ADMIN_KEY` | `pos` | Password of the `pos` user. |
| `PGTEST_APP_KEY` | sha256 of `umkmall-pos local test role` | Password set for `pos_app` by the test setup. |

Example for a local pos-api (use your own values):

```bash
export DATABASE_URL='postgres://pos_app:<your-pos_app-key>@localhost:5544/pos'
export POS_SESSION_SECRET="$(openssl rand -hex 32)"
export POS_SERVICE_KEY="$(openssl rand -hex 16)"
export UMKMALL_WEB_URL='http://127.0.0.1:9099'
```

## 4. Local dev database (once per database)

The test setup does all of this automatically inside `PGTEST_DB` (`test/support/global-setup.ts`). For a manual dev database,
run the same steps in this order (`ops/` files are the owner-run scripts; the first one is for local and CI only):

```bash
docker compose exec -T postgres psql -U pos -d pos -v ON_ERROR_STOP=1 < ops/local-public-users.sql
docker compose exec -T postgres psql -U pos -d pos -v ON_ERROR_STOP=1 < ops/pos-role.sql
docker compose exec postgres psql -U pos -d pos -c "ALTER ROLE pos_app PASSWORD '<your-pos_app-key>'"
npm run build -w pos-api          # the migrator runs from dist/
npm run db:migrate -w pos-api     # node dist/db/migrate.js, uses DATABASE_URL (as pos_app)
```

Never run `ops/local-public-users.sql` against a UMKMall database. `ALTER ROLE` is cluster-wide (see section 13).

## 5. Automated suite

Full local gate (from `CLAUDE.md`):

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- `npm test` runs `turbo test`. pos-api runs `jest --runInBand` (unit specs in `src/**/*.spec.ts`, 4 files, and e2e
  specs in `test/**/*.e2e-spec.ts`, 17 files). pos-web runs `vitest run` (unit `src/**/*.test.ts`, 12 files).
- **Own database per session:** `PGTEST_DB=pos_qa npm test`. `turbo.json` passes `PGTEST_DB` through.
- Every jest run, including a single-spec run and unit specs, first creates `PGTEST_DB` if needed and runs
  `DROP SCHEMA pos CASCADE` in it, then rebuilds it from `ops/` and migrations. **Everything in that database's `pos` schema is wiped on each run.**
- pos-api only: `PGTEST_DB=pos_qa npm test -w pos-api`. pos-web only: `npm test -w pos-web`.
- One spec file: `PGTEST_DB=pos_qa npm test -w pos-api -- test/sales.e2e-spec.ts` (args after `--` go to jest; global setup still runs).
- Fixtures to reuse: `test/support/fixtures.ts` `createStore()`, `test/support/staff.ts` `createCashier(app, store, permissions, pin)`.

## 6. Start pos-api and pos-web on your own ports

pos-api (watch mode, `nest start --watch`):

```bash
PORT=3010 npm run start:dev -w pos-api        # with the env from section 3 exported
curl -s localhost:3010/health                 # GET /health (health.controller.ts)
```

pos-web (dev server):

```bash
POS_API_URL=http://localhost:3010 POS_WEB_URL=http://localhost:3111 POS_DEV_USER_ID=<id> npm run dev -w pos-web
```

The `dev` script is `vite dev --port 3101` and `vite.config.ts` sets `server.port: 3101`. **Running on another port:** TBD
(not run here). Likely `npx vite dev --port 3111` from `apps/pos-web`, which needs checking. Use a second hostname
(section 12) so the two sessions' cookies do not clash.

## 7. Sign in locally without UMKMall

Localhost gets no UMKMall cookie, so use the dev sign-in. It is refused when `NODE_ENV=production`.

1. Create a stub UMKMall user (needs `ops/local-public-users.sql` from section 4):
   ```bash
   docker compose exec postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"
   ```
2. Start pos-web with `POS_DEV_USER_ID=<that id>` (section 6).
3. Open http://localhost:3101/ and press **"Masuk (pengembangan)"**. This posts to `/masuk/dev`, which calls pos-api
   `POST /auth/dev/sign-in`.
4. **Session limit: 15 minutes** (`SESSION_TTL = 15 * 60` in `auth.controller.ts`). The dev session has no UMKMall
   `sid`, so it cannot refresh. Sign in again after 15 minutes.

Owner session over HTTP (pos-api):

```bash
curl -s -X POST localhost:3010/auth/dev/sign-in -H 'content-type: application/json' -d '{"userId":"<id>"}'
# -> { "sessionToken": "...", "expiresIn": 900, "tenant": { "id": "..." } }
# then send:  -H "authorization: Bearer <sessionToken>"
```

Cashiers sign in by PIN: `POST /auth/pin`, header `x-pos-device: <deviceToken>`, body `{"staffId":"...","pin":"..."}`.

## 8. Seed a test store

The repo has **no seed script** (TBD, not in repo yet). Two options:

- **Automated:** the e2e specs create their own stores with `createStore()` and `createCashier()` (section 5).
- **Manual:** the curl sequence below, checked against each controller and schema. `API=http://localhost:3010`; owners hold every permission.

1. Store A owner: section 7 (stub user, `POST /auth/dev/sign-in`).
2. Category: `POST /catalog/categories` `{"name":"Minuman"}`. Keep the returned `id` as `CAT`.
3. Products: `POST /catalog/products` `{"categoryId":"<CAT>","name":"Es Teh Manis","sellingPrice":5000,"costPrice":2000,"unit":"gelas"}`
   (`sellingPrice` is integer rupiah; cost must not exceed selling price). Repeat for a few products.
4. Opening stock (needs `catalog.manage`): `POST /stock/opening` `{"productId":"<P>","qty":50,"unitCost":2000}`.
5. Roles and cashiers (needs `staff.manage`):
   - `POST /roles` `{"name":"Kasir","permissions":["sales.create"]}`
   - `POST /staff` `{"name":"Sari","pin":"123456","roleIds":["<role id>"]}` (PIN is 4 to 8 digits)
   - `POST /staff/devices` `{"name":"Kasir depan"}`. Keep the returned `deviceToken`.
6. **Cashier with a void permission:** `sales.void` **does not exist** (`src/staff/permissions.ts` lists `sales.create`,
   `sales.price_override`, `catalog.manage`, `reports.view`, `staff.manage`, `purchasing.manage`, `members.manage`,
   `vouchers.manage`, `receivables.manage`). **TBD (not in repo yet).** Until it exists, a stand-in cashier can use
   `["sales.create","sales.price_override"]`. Label it as a stand-in in any test notes.
7. Cashier sign-in and shift: `POST /auth/pin` (header `x-pos-device`), then `POST /shifts/open` `{"openingCash":100000}`.
   A sale needs the actor's open shift (`sales.service.ts`).
8. Voucher (needs `vouchers.manage`): `POST /vouchers`
   `{"name":"Diskon 10%","code":"DISKON10","type":"percentage","nominal":10,"kuota":100,"startDate":"2026-11-01","expired":"2026-12-31","minimalBuying":0}`.
   `code` is upper-cased. `percentage` nominal is 1 to 100. Dates are `YYYY-MM-DD`.
9. Sale as the cashier: `POST /sales` with header `Idempotency-Key: qa-sale-0001` (8 to 100 chars, `[A-Za-z0-9_-]`) and
   body `{"lines":[{"productId":"<P>","qty":2}],"paid":10000,"voucherCode":"DISKON10"}`. `voucherCode` is optional.
   Repeating the same key returns the first sale.
10. **Second tenant (cross-tenant):** repeat step 1 with a second stub user to get store B. Then, with store B's token,
    `GET /catalog/products/<A product id>` should return **404**. The same rule applies to update and delete (`PATCH`,
    `DELETE`) on A's ids, for example `/vouchers/<id>`. This is the rule in `CLAUDE.md`. Verify it yourself, since the
    specs do not run this exact curl sequence.

## 9. Simulate the UMKMall `/api/auth/me` stub

pos-api calls `${UMKMALL_WEB_URL}/api/auth/me` with **only** the cookies `auth_token` and `auth_refresh`. The contract,
from `auth.controller.ts` and `test/auth.e2e-spec.ts`:

| Stub answer | pos-api answer |
|---|---|
| `200` with `{"success":true,"user":{"id":"<public.users id>","name":"..."}}` | Owner session (`sessionToken`) |
| `401` | `401` |
| `5xx`, timeout after 5 s, or unreachable | `503` |
| `Set-Cookie` headers | Relayed to the browser unchanged |

The e2e spec's stub is inline in `test/auth.e2e-spec.ts`. A reusable stub script is **TBD (not in repo yet)**. Ad hoc (not in repo):

```bash
STUB_USER_ID=<id> node -e "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({success:true,user:{id:process.env.STUB_USER_ID,name:'Stub'}}))}).listen(9099)"
```

With pos-api on `UMKMALL_WEB_URL=http://127.0.0.1:9099`:

```bash
curl -i -X POST localhost:3010/auth/umkmall/session -H 'cookie: auth_token=x; auth_refresh=sid.y'   # expect 200
curl -i -X POST localhost:3010/auth/umkmall/session                                                  # expect 401, no cookies
```

## 10. Reset data

- **Test runs:** no reset needed. Each `npm test` rebuilds the `pos` schema of its `PGTEST_DB`. Use a new `PGTEST_DB` name for a clean slate.
- **Dev database, schema only:**
  ```bash
  docker compose exec postgres psql -U pos -d pos -c "DROP SCHEMA IF EXISTS pos CASCADE"
  ```
  Then repeat section 4 from the `ops/` steps. Stub rows in `public.users` remain.
- **Images:** delete the directory named by `POS_STORAGE_DIR` (default `.storage`, relative to the pos-api cwd).
- **Everything:** `docker compose down -v` removes the container's data volume (TBD: not run here; the postgres image declares a
  data volume). Afterwards run section 2 and section 4 again.
- **Browser:** clear the `pos_session` cookie to sign out.

## 11. Simulate the agent/MCP endpoint (`POST /mcp`)

**TBD (not in repo yet).** No `/mcp` route exists in `apps/pos-api/src` or `apps/pos-web/src` (checked 2026-11-24).
When it lands, document the auth (owner or cashier bearer), the request body, and a curl example here.

## 12. Logs

| Where | What |
|---|---|
| pos-api | Nest `Logger` writes to the terminal running `start:dev`. The code never logs tokens, PINs, phone numbers or customer names. |
| pos-web | The terminal running `npm run dev -w pos-web`. |
| Postgres | `docker compose logs -f postgres` |
| Tests | Jest and vitest output in the terminal. The repo writes no log files. |

Cookies are not port-scoped, so two sessions on `localhost` share `pos_session`. Use a second hostname such as `qa2.localhost`
(as in `docs/qa/2026-11-17-qa-sweep-b.md`).

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `connection refused` on 5544 | Postgres not running | `npm run db:up`; check `docker compose ps` |
| `password authentication failed for user "pos_app"` after a test run | Global setup runs `ALTER ROLE pos_app PASSWORD` with the test key (`PGTEST_APP_KEY`), which is cluster-wide | Set `DATABASE_URL` to that key, or set `PGTEST_APP_KEY` to your dev key, or re-run the `ALTER ROLE` from section 4 |
| `Invalid environment: <names>` at boot | A required pos-api variable is missing or too short (names are printed, not values) | Fix the variable named in the message (section 3) |
| `PGTEST_DB must be a lower-case identifier` | Bad database name | Use `^[a-z][a-z0-9_]{0,62}$` |
| `relation "pos.tenants" does not exist` or migrations missing | Migrations not applied to the dev database | `npm run build -w pos-api && npm run db:migrate -w pos-api` |
| `Pengguna tidak ditemukan` (422 on `userId`) | `POS_DEV_USER_ID` or the body id is not in `public.users` | Insert the stub user (section 7) and use its id |
| "Masuk (pengembangan)" button missing, or `/masuk/dev` returns 404 | `POS_DEV_USER_ID` unset in pos-web, or `NODE_ENV=production` | Set `POS_DEV_USER_ID` on the pos-web process |
| Redirected to sign-in after about 15 minutes | Session TTL is 15 minutes; dev sessions cannot refresh | Sign in again (section 7) |
| `503` on `/auth/umkmall/session` | Stub down, slower than 5 s, or unreachable | Start the stub (section 9); check `UMKMALL_WEB_URL` |
| `401` "Akun UMKMall tidak ditemukan" on `/auth/umkmall/session` | No `public.users` row for the stub user id | Insert the row (section 7) |
| `Idempotency-Key tidak valid` (422) on `POST /sales` | Header missing or not 8 to 100 chars of `[A-Za-z0-9_-]` | Send a valid key |
| Sale refused for a cashier | No open shift for that cashier | `POST /shifts/open` as the cashier first (section 8, step 7) |
| Permission error for `sales.void` | The key does not exist in the repo | TBD (section 8, step 6) |
| `EADDRINUSE` | Port already used by another session | Choose another `PORT` (section 6) |
| Two sessions log each other out | Shared `pos_session` cookie on `localhost` | Use distinct hostnames (section 12) |
| `payment-api` commands do nothing | Folder not present in the repo | TBD (not in repo yet) |
