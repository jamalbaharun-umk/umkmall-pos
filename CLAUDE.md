# CLAUDE.md — umkmall-pos

UMKMall's multi-tenant Point of Sale: `apps/pos-api` (NestJS 11, Drizzle, Postgres schema `pos`) and
`apps/pos-web` (TanStack Start + Vite + Tailwind 4). A GPL-3 port of [Lakasir](https://github.com/lakasir/lakasir)
(reference checkout for porting: `~/Documents/lakasir-test`, upstream commit in `NOTICE`).
Epic: Linear **UMK-1924**. Plan: [docs/plans/2026-11-17-001-feat-pos-epic-plan.md](docs/plans/2026-11-17-001-feat-pos-epic-plan.md).
Lakasir behaviour and its known flaws: [docs/reference/lakasir-findings.md](docs/reference/lakasir-findings.md).

This file adapts the UMKMall monorepo's rules (its `CLAUDE.md`, `docs/principles/`). Where this file is
silent, follow the monorepo's principles.

## Process

- **One unit per change.** Work maps to a unit U0–U9 of the epic plan. Before code, write that unit's plan
  in `docs/plans/YYYY-MM-DD-NNN-feat-umk-1924-u<n>-<topic>-plan.md`: goal, Definition of Done (each line
  `[test]`/`[cmd]`/`[qa]`/`[manual]`), files, tests to add. Units state intent, not code.
- **Trunk-based, no PR review in this repo.** Commit straight to `main` once the local gate passes:
  `npm run lint && npm run typecheck && npm test && npm run build` (Postgres up: `npm run db:up`). CI runs the
  same on every push; a red `main` is fixed before anything else lands.
- **Conventional commits** with a scope from `commitlint.config.js` (`feat(catalog): …`), ending with
  `Refs: UMK-1924 U<n>`. Small commits on logical boundaries.
- **Evidence over assertion.** Report only checks you ran. Every new behaviour gets a test; a guard test is
  proven once by breaking what it guards (revert-red) and restoring it.
- **UMKMall monorepo changes** (shared login cookie UMK-1947, U8 erasure hook) go through the monorepo's own
  process: `/team-plan` → `/team-work` → `/team-ship`, a PR, its review gate. Never push to its `main`.
- When a unit is done: tick it in the epic plan's Rulings, comment on UMK-1924 (what shipped, tests, what was
  not exercised).

## Parallel sessions (several agents push to `main`)

- **Own your test database.** Every session runs tests with its own `PGTEST_DB` (for example
  `PGTEST_DB=pos_u2 npm test`); the default `pos` database belongs to whoever runs without it, and a shared one
  gets its `pos` schema wiped mid-run by another session. Run servers on your own ports too.
- **Own your module.** A unit works in its own directories: `apps/pos-api/src/<module>/`, its test files,
  `apps/pos-web/src/routes/<area>/`. Shared files (`app.module.ts`, `db/schema/index.ts`, route tree) take a
  one-line addition only.
- **Rebase, never merge, never force.** `git pull --rebase origin main` before every push. On a conflict,
  keep both sides' additions.
- **Migrations collide.** drizzle-kit numbers files and keeps one journal. Before pushing a migration:
  rebase, delete YOUR uncommitted `drizzle/NNNN_*.sql` and its snapshot, re-run `npm run db:generate -w pos-api`,
  rerun the tests. Never edit a migration that is already on `main`; add a new one.
- **Dependencies:** `npm install <pkg> -w <app>` only; rebase conflicts in `package-lock.json` are resolved
  by re-running `npm install` after the rebase.

## Rules a green suite will not catch

- **Tenant from the session only.** Every query on a tenant table filters `tenantId = session.tenantId`
  (`@CurrentSession()`). Never take a tenant id from body, query or path (`src/guards.spec.ts` greps for it).
  Every resource ships a **cross-tenant test**: store B gets 404 on store A's ids, for read, update and delete.
- **Every table:** in `pos` (`pos.table(...)` from `db/schema/_base.ts`), `.enableRLS()`, a `tenant_id` FK to
  `pos.tenants` (except `tenants`), exported from `db/schema/index.ts`. `test/db.e2e-spec.ts` fails a table
  without RLS.
- **Money is integer rupiah** (`rupiah()` column, `number` in TS). No floats, no decimals, no `toFixed`.
- **The server computes every price and total.** A client-sent price is ignored unless the actor holds the
  override permission (U4); cost is always stored.
- **Tax is computed after discounts.** Voucher quota and stock change only inside the sale's transaction,
  under a row lock (`select … for update`) or an atomic `update … where qty >= n`.
- **Money and state changes are idempotent:** sale creation takes an `Idempotency-Key`; a retry returns the
  first result.
- **Default roles** (`DEFAULT_ROLES`): Pemilik (everything), Admin (everything but
  `ADMIN_EXCLUDED_PERMISSIONS`: `staff.manage`, `payments.manage`), Kasir. Only Pemilik holds `payments.manage`.
  Changing the Admin constant changes new stores only: existing ones got the role from migration `0030`.
- **A cashier device is paired by code** (UMK-2022, `src/staff/device-pairing.ts`): the signed-out device asks for
  a 6-digit code (`POST /auth/device/pairing`), and the code is accepted only inside a signed-in session with
  `staff.manage` (`POST /staff/devices/pair`), which binds the device to that session's store. Only hashes are
  stored; 10 minutes (`PAIRING_CODE_TTL_SECONDS`), single use, wrong codes lock the store like PIN sign-in
  (`lockSeconds`). `device_pairings.tenant_id` is null until the claim. Never log a code or a pairing token.
  Asking for a code needs no session, so open codes are capped in all (`MAX_LIVE_PAIRINGS`) and per network
  address (`MAX_LIVE_PAIRINGS_PER_ADDRESS`), counted and inserted under one advisory lock; code requests and
  status polls are also limited per address in memory, before the database (`src/staff/address-limits.ts`). "One
  address" is `addressKey`: an IPv4 address or an IPv6 /64; a full limiter never refuses an unseen address, it
  counts it by its /48 and then in one shared count. The address is `req.ip`: set `POS_TRUSTED_PROXIES` to
  the proxies in front of pos-api, and a relay (pos-web) must pass the device's address on in `X-Forwarded-For`,
  or every device shares one cap.
- **Gate actions with `@RequirePermission('<key>')`** (`src/staff/require-permission.ts`; keys in
  `src/staff/permissions.ts`, add new ones there). Owners hold every permission; a cashier holds their roles'
  permissions, loaded per request by the session guard (`session.permissions`). Inline checks use
  `hasPermission(session, key)` (U3: a client price counts only with `sales.price_override`).
- **Validate at the boundary with zod;** a bad input answers 422 (never 500). Errors never echo internals.
- **POS tokens are signed and verified only in `src/tenancy/session.ts`** (guard test). The POS never holds
  UMKMall's `auth_token` HS256 key. Owner sign-in (UMK-1945): pos-web forwards only UMKMall's `auth_token` and
  `auth_refresh` cookies (shared on `.umkmall.id`, UMK-1947) to `POST /auth/umkmall/session`, which asks
  `${UMKMALL_WEB_URL}/api/auth/me` (5 s; 401 → 401, 5xx/timeout → 503) and opens a 15-minute owner session; the owner
  refresh repeats that call. **Every `Set-Cookie` from `/auth/me` goes back to the browser unchanged** (pos-api and
  pos-web both relay it): it can mint UMKMall's refresh cookie once, and dropping it signs the owner out of UMKMall.
  Never forward any other cookie to UMKMall.
- **No `console`** in `src/` (lint + guard). Never log tokens, PINs, phone numbers or customer names.
- **Erasure:** the tenant FK to `public.users` is `ON DELETE RESTRICT`; a store is erased by the U8 purge,
  which must cover every new table and every stored image. `POST /internal/tenants/purge` (`src/purge/`)
  deletes every `pos` table with a `tenant_id` column, discovered at runtime, so a new table needs `tenant_id`
  (guard in `test/purge.e2e-spec.ts`; only `tenants` is exempt) and its images under
  `tenants/<tenantId>/`. UMKMall's archival (role `postgres`) reads `pos.tenants (id, user_id)` to wait for the
  purge (migration `0012`); grant it nothing more. pos_app reads nothing in `public.users`
  (deny-all RLS); the purge asks UMKMall's SECURITY DEFINER `public.pos_account_erasable(uuid)` (UMKMall migration
  0198, EXECUTE granted to pos_app by `ops/pos-role.sql`) and answers 409 unless the account is marked `to_delete` and past its 30-day grace window.
  Order per environment: 0198 → `ops/pos-role.sql` → `POS_PURGE_ENABLED`.
- **Licence:** keep `LICENSE`/`NOTICE`.
- **UI is `@umkmall/ui` + the admin theme** (owner decision 2026-11-17): build screens from `@umkmall/ui`
  (`/primitives`, `/compositions`, `/layouts`), styled by `apps/pos-web/src/styles/app.css` (a copy of the UMKMall
  admin dashboard css). The package is a vendored copy in `packages/ui` (see its `POS-COPY.md`): never edit it here.
  Layout and flows follow Lakasir screen by screen (`~/Documents/lakasir-test`, running at http://localhost:8090).
  The GPL-3 implication of bundling it is noted on UMK-1924 for legal.
- **Copy is Indonesian,** every screen has loading, empty and error states.
- **Navigation is one file:** `apps/pos-web/src/nav.ts` (Lakasir's groups and order). A new screen adds or fixes
  its one line there (`{ to, label, icon, permission? }`); an entry shows only when its route exists and the actor
  holds the permission. The shell (`components/shell.tsx`, mounted in `__root.tsx`) wraps every signed-in page except
  the route ids in `BARE_ROUTES`. Screens use `components/page.tsx` (`Page`, `Panel`, `Empty`, `PageLoading`,
  `PageError`) for Lakasir's page layout.

## payment-api (UMK-1991)

`apps/payment-api` is the one service that records payments and, later, talks to a payment gateway (PG). Plan:
[docs/plans/2026-11-24-003-feat-umk-1991-payment-api-plan.md](docs/plans/2026-11-24-003-feat-umk-1991-payment-api-plan.md).
The rules above apply to it (integer rupiah, zod → 422, no `console`, RLS and `tenant_id` on every table, cross-tenant
test per resource, idempotent money changes), with these differences:

- **Own database, own role.** Database `payment`, schema `payment`, role `payment_app` (`ops/payment-role.sql`, run once
  per environment by a database owner, after `CREATE DATABASE payment`). It shares nothing with `pos` or UMKMall's
  `public`: no cross-database foreign key, so `tenant_id` is a plain uuid.
- **Own test database.** `PAYTEST_DB` (default `payment_test`; a name starting with `pos` is refused). Parallel
  sessions each set their own: `PAYTEST_DB=pay_u2 npx jest --runInBand` in `apps/payment-api`.
- **Service to service only.** Every route but `/health` needs `X-Payment-Service-Key` (env `PAYMENT_SERVICE_KEY`,
  constant-time compare). **The tenant comes from the `X-Tenant-Id` header only**, set by the calling service from its
  own session and read only after the key check, in `src/auth/service.guard.ts` (guard test). Never from body, query
  or path. Never expose payment-api to a browser.
- **Generic contract.** Order reference (`orderRef`), actor reference, never sale, shift or cashier. One live payment
  per order (no split payment). Void and refund are for the full amount.
- **Only adapters talk to a PG.** One contract (`src/adapters/adapter.ts`: `charge`, `getStatus`, `void`, `refund`,
  `handleWebhook`, plus `supportsVoid`/`supportsRefund`). A new PG is one adapter added to `PAYMENT_ADAPTERS`; callers
  and routes do not change. CASHAC methods (`cash`, `edc_debit`, `static_qris`) are cancelled by **void**, with
  no outbound call; PG payments are cancelled by **refund**. Kasbon is not a payment method: the caller keeps the
  receivable and each instalment is its own payment with its own `orderRef` (`<receivableId>:<n>`). No PG adapter before the legal gate (UMK-1977); nothing
  under `src/` may call out (guard test) until then. The PG flow is proven with `test/support/fake-gateway.ts`.
- **The fake gateway is local only** (`src/adapters/fake/`, plan
  [2026-11-25-003](docs/plans/2026-11-25-003-feat-umk-1991-fake-gateway-plan.md), usage there). It exists only when
  the environment variable `PAYMENT_ADAPTERS=fake` (not the DI token of the same name; methods `fake_qris`,
  `fake_va`; bills in memory) and only with `NODE_ENV` explicitly `development` or `test`: production and an unset
  `NODE_ENV` are a boot error (fails closed, checked in `loadEnv` and again in the gateway's constructor). Its
  settings such as `refundMode` are process-global, not per tenant. Its controls (`/dev/fake-gateway/…`) sit
  behind the service key and the tenant header like every route, reach only that tenant's bills, change only the
  gateway's own state and notify through `WebhooksService.receive`: they never write a payment and never call out.
- **A store is onboarded at a PG before it is charged there** (UMK-2019, plan
  [2026-11-25-004](docs/plans/2026-11-25-004-feat-umk-1991-pg-onboarding-plan.md)). One `merchant_accounts` row per
  `(tenant, provider)`; statuses `not_submitted`, `submitted`, `needs_fix`, `rejected`, `verified`, `active`,
  `suspended`, changed only in `src/merchants/merchants.service.ts` under `select … for update`, by
  `src/merchants/transitions.ts`. **A PG charge is refused (409 `merchant_not_active`, `method_disabled`,
  `live_disabled`, `merchant_mode_mismatch`) unless the account is `active`, in the environment's mode, with the
  method on**; a replay of a charge key still answers its payment; CASHAC is never gated. A test about payments
  seeds an active account (`test/support/merchants.ts`; `createStore` does it), never a bypass in `src/`.
- **The gateway's word about an account is applied only when it is news.** `settle` asks the gateway before it
  locks the row, so under the lock it discards an answer older than `status_observed_at` (the gateway's
  `updatedAt` of the account), any answer read before the owner's latest submit (`submitted_at` changed) and any
  answer while `draft_undelivered` is set. An answer without the gateway's time is never ordered by a clock of
  ours: it is applied only when no other answer was applied since the row was read (`sync_version`), else the
  gateway is asked again (also for an answer with the SAME time as the stored one). That marker is set by every submit and cleared when the gateway took the draft
  (`createAccount`, or `updateAccount` for an account it already has); never infer delivery from
  `provider_account_id`. The reconciliation asks about `submitted` accounts after the usual threshold and about
  `needs_fix`, `rejected`, `verified`, `active` and `suspended` ones every `SLOW_RECONCILE_INTERVAL_MS`
  (`transitions.ts`); it stamps `reconcile_attempted_at` just before asking about each, so an account that keeps failing goes to
  the back of the queue.
- **Onboarding has its own adapter contract** (`src/adapters/onboarding.ts`, `ONBOARDING_ADAPTERS`): each adapter
  declares `verification` (`hosted`, `platform`, `own_keys`), `modes` and `methods`. Only `hosted` is served: the
  owner verifies on the PG's own page, and **no identity document, identity number or bank account ever reaches
  the POS or payment-api** (the draft schemas are strict). `own_keys` is designed, not built
  (`credentials_encrypted` is written and answered by nothing). The PG's account reference and every secret stay
  in payment-api: no route answers them. `POST /webhooks/:provider/accounts` follows the webhook rule below (the
  status is read again from the PG; the body is not stored).
- **Modes:** `PAYMENT_GATEWAY_MODE` (`fake` default, `sandbox`, `live`), one per environment. `live` needs
  `PAYMENT_LIVE_ENABLED` (default off; a boot error without it) and stays off until the legal gate (UMK-1977).
- **Void and refund need `reasonCode`, `actorRef` and `approvedBy`** (the supervisor the caller verified by PIN;
  payment-api stores it, pos-api verifies it). Every status change writes a `payment_events` audit row and an `outbox`
  row in the same transaction.
- **One place changes a payment's status:** `src/payments/settlement.service.ts`, under `select … for update`, by the
  table in `src/payments/transitions.ts` (forward only; the one backward move is `refund_failed` → `refund_pending`).
  Webhook, manual sync and reconciliation all call `settle`. The row is committed as `created` before the PG is called.
- **A webhook is never trusted.** `POST /webhooks/:provider` is the one route without the service key: the adapter
  checks the signature (401), the event is stored once per `(provider, event_id)`, then status and amount are fetched
  again from the PG. The tenant of a webhook or a reconciliation sweep comes from our payment row, never the payload.
- **Money that arrives is never dropped.** A payment the PG reports after the bill closed, a second payment or another
  amount becomes an `unmatched_receipts` row (`needs_review`), refunded automatically when
  `PAYMENT_LATE_AUTO_REFUND` is on. A closed payment never becomes `paid`. The reconciliation keeps asking about
  closed bills until expiry plus `PAYMENT_LATE_SWEEP_SECONDS`, so a lost webhook does not hide late money.
- **`POST /payments/close` closes a charge key for good** (same key and body as the charge): no payment under the
  key → a `cancelled` one is written under it, so a charge that arrives later answers it and never pays; a payment
  under the key is answered unchanged, also a `paid` one. A caller cancels its order for want of a payment only on
  this answer.
- **A refund's key at the PG is `payments.refund_key`,** set when the payment moves to `refund_pending`. Never derive
  an idempotency key from the audit trail: notes are written there too.
- **Purge:** `POST /internal/tenants/purge` deletes every `payment` table row with the header's `tenant_id`, discovered
  at runtime; a new table needs `tenant_id` (guard in `test/purge.e2e-spec.ts`). It answers 409 `payments_in_flight`
  while money is still moving.
- Env: `DATABASE_URL` (the `payment_app` role), `PAYMENT_SERVICE_KEY` (≥ 16 chars, the same value in every caller),
  `PORT` (default 3001), and the optional `PAYMENT_*` flow settings (`src/config.ts`, names in `.env.example`).
  Commit scope: `payment-api`.

### pos-api's side (`apps/pos-api/src/payments-client/`)

Plan: [docs/plans/2026-11-24-007-feat-umk-1991-pos-payment-integration-plan.md](docs/plans/2026-11-24-007-feat-umk-1991-pos-payment-integration-plan.md).

- **Switch:** `PAYMENT_API_URL` unset (or empty) → payment-api is off and pos-api works as before (one-step sale,
  nothing sent); this is how local dev and every test but `test/payments-integration.e2e-spec.ts` run. Set →
  `PAYMENT_SERVICE_KEY` is required, and in production the URL must be https (`PAYMENT_API_ALLOW_HTTP=true` only for
  a private network). Also `PAYMENT_API_TIMEOUT_MS` (5000), `POS_PAYMENT_RECONCILE_INTERVAL_SECONDS` (60, 0 = no
  timer), `POS_PAYMENT_RECONCILE_AFTER_SECONDS` (120, at least twice the timeout), `POS_PAYMENT_SYNC_MAX_ATTEMPTS`
  (10). pos-api refuses to start with payment-api off while a sale is `awaiting_payment`.
- **Only `payments.client.ts` reads the service key and writes `X-Payment-Service-Key` and `X-Tenant-Id`** (guard
  test). Every client method takes the tenant id first: `session.tenantId`, or the tenant of the pos row the job or
  the purge is working on. Never log the key, a header or a body.
- **A sale is two steps** (cash → `cash`, debit → `edc_debit`, wallet → `static_qris`): written as
  `awaiting_payment` with stock and voucher taken, then charged with key `<saleId>:<attempt>` (`sales.payment_attempt`,
  1 unless the sale was switched to cash) for the amount due (cash: `total + rounding`) and completed on `paid`. No
  clear answer → 503 and the sale stays `awaiting_payment`; a payment closed unpaid → `cancelled`, stock and voucher
  back. A cancelled sale is never completed. All of this is `PaymentSync.settle`.
- **A PG sale waits for its payment** (plan
  [2026-11-25-006](docs/plans/2026-11-25-006-feat-umk-1991-pg-cashier-flow-plan.md), the routes and their shapes are
  there). A payment method of kind `online` carries payment-api's method (`ONLINE_METHODS` in `payments.client.ts`:
  only the fake gateway's `fake_qris` and `fake_va`, also a database check). Online payments are on only with
  payment-api on and `NODE_ENV` explicitly `development` or `test` (`PaymentSync.onlineEnabled`; production and an
  unset `NODE_ENV` refuse them, UMK-1977), asked when a method is created AND at every sale.
  `POST /sales` answers `awaiting_payment` with `payment` (QR or VA, `expiresAt`). pos-api learns the outcome by the
  screen's poll (`GET /sales/:id/payment`), the manual check (`POST …/payment/check`, the PG is asked) and the job;
  payment-api pushes nothing. Statuses shown are payment-api's own; pos-api never decides `expired` by its clock.
  A charge payment-api refuses because the store may not charge there (`GATE_REFUSALS`) closes the charge key and
  cancels the sale at once (409 with the `code`).
- **Switch to cash is written before anything is closed, and only the cashier's request does it:**
  `sales.switch_cash_paid` first, then that request (`settle` mode `cash`) closes the PG bill, turns the sale into a
  cash sale with attempt + 1 and charges it; a bill the customer paid first completes the PG sale instead (409
  `already_paid`). A request without a usable answer takes the intent back (`abandonCashSwitch`) and says so; a
  poll, a check or a repeat of the sale never switches and never cancels a sale that has an intent; the job
  closes nothing for a switch: it finishes one only when the bill is already `cancelled` (closed for it), and takes
  back an intent whose bill ended by itself or never existed, then cancels the sale. Late money on the closed bill is
  payment-api's (unmatched receipt, auto-refund); pos-api only shows it. Cancelling an awaiting sale needs no PIN
  and writes no void.
- **An answer is applied only to the sale that was read:** `applyToSale` takes the attempt the payment belongs to
  and answers `stale` (read again) when the sale is at another attempt, or would be cancelled with a switch to cash
  asked. A new write of a sale's step 2 keeps both checks.
- **A sale's payment routes are for its cashier or a `sales.void` holder** (the answer carries the QR), and every
  action on them, and every refund route, starts with `assertPersonAtTill(s.kind)` (guard test).
- **A paid PG sale is refunded, never voided** (`POST /sales/:id/refund`; a void answers 409 `use_refund`, a refund
  of a CASHAC sale 409 `use_void`, both before the PIN is checked). The refund is the void record with
  `sale_voids.refund_status` (`pending`, `succeeded`, `failed`): same reasons, same PIN approver, the sale reversed at
  once, the refund asked after the commit and followed by the job. Retry needs `sales.void`; "dikembalikan manual" is the owner's alone.
- **Never call payment-api inside a database transaction or under a row lock** (guard test; the purge is the one
  exception). Read the pos row, call, then write; the one write of a sale's step 2 locks the sale and applies the
  answer only while it still awaits payment. Every transaction of `payments-client/` is in `payment-sync.service.ts`.
- **A sale is cancelled only on a payment that payment-api says is closed.** "No payment found" is not an answer to
  cancel on: the job first closes the charge key (`POST /payments/close`, which writes a `cancelled` payment under
  it), so a charge still on its way can never be paid later.
- **`awaiting_payment` and `cancelled` sales are not receipts:** every list, report and shift total filters
  `FINAL_SALE_STATUSES` (`db/schema/sales.ts`). A new query on `pos.sales` must too. A shift does not close while one
  of its sales awaits payment.
- **A sale is dated by `sales.paid_at`, not `created_at`,** in every day-based figure and in the sales list (owner
  ruling 2026-11-25): the time it was rung up when paid at once; for a sale that waited for a PG, payment-api's paid
  time (validated by `isoTime`, kept between creation and now, else the time it is applied); the switch to cash;
  and for any sale completed later (also cash/EDC by the job) the time it completes. A day can still grow after
  it is over (a payment learned late is dated when the customer paid). A new report or list of sales by day
  filters `paid_at`.
- **Kasbon payments and voids are recorded after the pos commit** (`receivable_payments.seq`/`payment_id`, order
  reference `<receivableId>:<seq>`; `sale_voids.payment_sync_pending`), and the job (`PaymentSync.tick`) repeats what
  failed. A void sends the void's reason, actor and PIN-verified approver.
- **The job never rejects, stops at the first unanswered call, and parks a row payment-api keeps refusing**
  (`pos.payment_sync_issues`; `GET /payment-sync/issues`, `POST /payment-sync/issues/:id/retry`). Log row ids,
  codes and counts only.
- **The purge calls payment-api's purge** inside its transaction, after every pos delete and just before the commit;
  a failure rolls the pos deletes back and answers 503.
- The integration tests start the real payment-api app in-process on database `<PAYTEST_DB or payment_test>_pos`;
  `test/pg-cashier-flow.e2e-spec.ts` starts it with the fake gateway and moves payment-api's clock.
- **"Pembayaran Online" (UMK-2019)** is `online-payments.controller.ts`: a thin pass to payment-api's
  `/merchant-accounts`, every route behind `payments.manage` (the cashier's `GET /online-payments/methods` behind
  `sales.create`). pos-api stores nothing of it; the client copies only the known fields of an account. A test
  that needs payment-api's fake gateway imports `test/support/payment-fake-env.ts` first.

## Commands

```bash
npm install                     # once, at the repo root
npm run db:up                   # local Postgres on :5544 (docker compose)
npm test                        # pos-api: unit + e2e against a fresh pos schema
npm run db:generate -w pos-api  # new migration from schema changes
npm run dev -w pos-web          # http://localhost:3101
```

`pos-api` needs `DATABASE_URL` (the `pos_app` role), `POS_SESSION_SECRET` (≥ 32 chars), `UMKMALL_WEB_URL` (UMKMall's
web origin, for `/api/auth/me`) and `POS_SERVICE_KEY` (same value as UMKMall's, for the purge) in its environment.
`pos-web` needs `POS_API_URL`, plus `UMKMALL_WEB_URL` and `POS_WEB_URL` (its own public origin) to send signed-out owners
to UMKMall's login. Names in `.env.example`. The POS must sit under UMKMall's cookie domain: `pos.umkmall.id`, and
`pos.preview.umkmall.id` on preview.

**Signing in locally without UMKMall** (localhost gets no UMKMall cookie; refused when `NODE_ENV=production`): create a stub UMKMall user in your
database, then start `pos-web` with `POS_DEV_USER_ID` set to it and press "Masuk (pengembangan)" on `/`
(`POST /masuk/dev` → pos-api `POST /auth/dev/sign-in`). The dev session has no UMKMall `sid`, so it cannot refresh:
sign in again after 15 minutes. Screens call pos-api through `api()` in `apps/pos-web/src/lib/api.server.ts`.

```bash
docker compose exec postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"
POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<that id> npm run dev -w pos-web
```
The `pos_app` role and `pos` schema are created once per environment by a UMKMall DB owner: `ops/pos-role.sql`.
