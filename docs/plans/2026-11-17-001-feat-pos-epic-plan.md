---
ticket: UMK-1924
tier: full
status: implementation-ready
cost: {plan_bytes: 23794, agents: {plan-researcher: 100006, plan-reviewer: 48971}}
---

# UMK-1924: UMKMall POS, a multi-tenant Point of Sale ported from Lakasir

> Moved from UMKMall/umkmall PR #1833 (closed) on 2026-11-17. Paths with no repo prefix (`apps/`, `packages/`, `docs/solutions/`, `docs/principles/`, `scripts/`) are in the UMKMall/umkmall monorepo; `docs/reference/` and `docs/plans/` are in this repo.

Tier: **full**. Touches risky paths (`apps/api/src/auth/`, `packages/payments/`, `apps/api/src/payments/`, `packages/database/migrations/`), adds a new service in a new repository, and the research changed the work (auth, deletion and webhook forks). This is an **epic**: each unit becomes its own ticket and its own `/team-plan` before any code.

## Ticket brief

From the PO in chat (2026-11-17); tracked as one ticket, UMK-1924 (milestones M0–M4 and every unit in its description). UMKMall becomes the POS for every UMKMall account: items, stock and sales are stored in the POS. The base is a free POS repo. We pick Lakasir (GPL-3, Laravel, already multi-tenant) and port it to a **NestJS** API ("we will scale this POS") plus a merchant web app shaped like the admin-dashboard (TanStack Start). It stands alone first; UMKMall web and mobile integrate later through the API. One UMKMall login. QRIS payments with UMKMall acting as escrow come later and depend on a legal check. Reference run: `docs/reference/lakasir-findings.md` (local Docker E2E: what works, 10 verified flaws, flows not exercised). Owner answers are `settled:` under Approach.

## Goal

A UMKMall account owner opens the POS, signs in with their UMKMall account, gets their own store, and runs it: catalog, stock in, cashier sales with shifts, members, vouchers, credit, reports. Cashiers use a PIN on a device the owner bound to the store. UMKMall never shares its session-signing key with the POS, a UMKMall logout or deletion ends the owner's POS access within 15 minutes, and erasing a UMKMall account erases its store.

## What research corrected

- "Xendit QRIS is already there": disproved (see Findings: Xendit is invoice-only).
- "RLS isolates tenants": disproved (see Findings: RLS backstop); isolation comes from app-code tenant filters plus tests.
- "The POS can verify the UMKMall token": only by holding the HS256 key, which can mint sessions, plus an `auth_sessions` read (see Findings: HS256 token, liveness). Hence the handoff token.
- "The `admin-dashboard` can be reused as-is": its auth is staff-only (see Findings: admin auth). Only the shell pattern carries over.
- Review: "a FK cascade from `public.users` deletes the store" was wrong; deletion never removes the `users` row and the purge is unbuilt (see Findings: archival keeps users, purge unbuilt). U8 is now an explicit erasure.
- Review: the HS256 key registry would let the legacy `JWT_SECRET` slot verify a handoff token (see Findings: legacy slot); U1 refuses it.
- Lakasir harness: two first "bugs" (invalid login JSON, timezone not saved) were artifacts of zsh `echo`; retracted in lakasir-findings.md.

## Findings

| # | Claim | Verdict | Evidence (`path:line` — quote) |
|---|---|---|---|
| 1 | No NestJS in the monorepo | confirmed | `apps/api/package.json` — `"hono": "^4.12.25"`; no `@nestjs` in any `package.json` |
| 2 | Server logic belongs in `apps/api` or a package | confirmed | `docs/principles/architecture.md:40` — "New server logic goes in a package or in `apps/api`" |
| 3 | HS256 token | confirmed | `packages/auth/src/verify.ts:58` — `algorithms: ['HS256']` |
| 4 | Liveness needs the DB | confirmed | `packages/auth/src/session.ts:195` — `isAuthSessionLive(sid)` selects `authSessions` |
| 5 | New signed credential = six files | confirmed | `packages/shared/src/key-registry.ts:30` — "registering its env vars EVERYWHERE"; guard `packages/config/src/key-env.test.ts` |
| 6 | Legacy slot under every credential | confirmed | `packages/shared/src/key-registry.ts:10` — "`JWT_SECRET` is the legacy entry underneath them" |
| 7 | Xendit is invoice-only | confirmed | `packages/payments/src/xendit/client.ts:143` — `${XENDIT_API_BASE_URL}/v2/invoices`; no `for-user-id` anywhere |
| 8 | Unknown invoices are acked and dropped | confirmed | `apps/api/src/payments/xendit-webhook.controller.ts:440` — "Unknown invoice — ack so Xendit stops retrying" |
| 9 | RLS backstop | confirmed | `packages/database/migrations/0058_enable_rls_public.sql:3` — "connects as a role that bypasses RLS"; loop is `n.nspname = 'public'` only |
| 10 | Drizzle sees `public` only | confirmed | `packages/database/drizzle.config.ts` — no `schemaFilter`, no `pgSchema` in the package |
| 11 | Archival keeps users | confirmed | `packages/database/src/schema/auth-sessions.ts:43` — "archival never deletes the `users` row … so a cascade would never fire" |
| 12 | Purge unbuilt | confirmed | `apps/api/src/auth/account-delete-service.ts:87` — "the UMK-1495 purge … is not built yet" |
| 13 | Tenant candidate | confirmed | `packages/database/src/schema/user-businesses.ts` — several rows per user, one `isPrimary`; `users` is the account |
| 14 | Admin auth is staff-only | confirmed | `packages/auth/src/admin-session.ts:5` — "`admin-session` … → admin-dashboard staff… Do not conflate them" |
| 15 | Money today is decimal | confirmed | `packages/database/src/schema/payments.ts:61` — `decimal('amount', { precision: 10, scale: 2 })` |
| 16 | Base image must be glibc | confirmed | `apps/api/Dockerfile:3` — "debian-slim (NOT alpine) … glibc binaries that break on musl" |
| 17 | PR envs hard-code 8 services | confirmed | `docs/runbooks/railway-pr-environments.md:23` — "`pr-base` holds 8 services" |
| 18 | Lakasir flaws to fix by design | confirmed | lakasir-findings.md "Verified bugs" 1-10 (local run 2026-11-17) |

Traps that apply: CLAUDE.md "Signing key + `kid` are one registration (UMK-845/919)" ("isolation-by-kid credentials refuse the legacy slot"); "`ai_chat_token` is read cookie-first" and "Two OTP pairs" (reuse neither); "A guard test only guards its own package" (`no-direct-auth-verify.test.ts` does not reach a new repo); "Migration state follows the BRANCH"; "`Secure` cookie predicate"; "Logging". Solutions: `docs/solutions/conventions/a-lock-test-passes-without-the-lock-unless-the-critical-section-is-held-open.md` (stock, voucher), `docs/solutions/security-issues/a-uuid-check-proves-a-format-not-whose-row-it-is.md` (tenant filters), `docs/solutions/security-issues/a-secret-in-a-url-path-breaks-every-log-line-that-assumed-paths-are-safe.md` (handoff token, webhook URLs).

## Approach

Two codebases. The new repository `umkmall-pos` (GPL-3) holds `pos-api` (NestJS) and `pos-web` (TanStack Start), ported from Lakasir, with its licence and attribution kept. The UMKMall monorepo gains only what UMKMall owns: the handoff and liveness routes, the store link behind a flag, the erasure hook, and later Xendit pieces. The repos meet at a signed handoff token, a Postgres schema `pos` (one FK to `public.users`), and HTTP.

- settled: NestJS in a separate repo `umkmall-pos`; rejected: `apps/pos-api` in the monorepo. `architecture.md #4` gains a recorded exception; `@umkmall/*` packages are not imported (unpublished, and see Risks on GPL).
- settled: direct port of Lakasir, GPL-3; rejected: clean-room. SaaS use needs no source release; handing a copy to a client does.
- settled: same Postgres, own schema `pos`, `tenant_id` on every table; rejected: a separate Postgres, and one database per tenant (Lakasir's model, ~3 s per signup plus one DB each).
- settled: login by handoff token signed with an **asymmetric** key, verified by public key (JWKS); rejected: sharing the HS256 key, and introspection on every request.
- settled: the owner's POS session lasts 15 minutes and each refresh asks `apps/api` whether the UMKMall session is still live; rejected: a long POS session with no check (deletion would not reach it).
- settled: tenant = `users.id`; rejected: `user_businesses.id`. Cashiers are local POS users.
- settled: cashier PIN on a device the owner bound to the store, lockout per store + cashier with backoff; rejected: store code + PIN on any device.
- settled: v1 = core retail, purchasing + supplier + stock opname, member + voucher + credit. QRIS is U9 behind the legal gate.
- NestJS builds with the Nest CLI default (`tsc`), not the `apps/api` esbuild bundle.
- Erasure is explicit, not a cascade: the FK from `pos.tenants` is `ON DELETE RESTRICT` (house convention, a forgotten purge fails loudly), and U8 deletes the tenant's rows and images.
- Fixed by design (lakasir-findings.md 1-10), each with a test: integer rupiah (`bigint`); server-authoritative prices, override only for a permission with cost always stored; tax after discounts; voucher quota taken atomically inside the sale transaction; row-locked stock; idempotency key on sale creation; every sale linked to an open shift; invalid input answers 422; correct report labels.
- Tenancy: every query filters by the tenant from the verified session, never from the client; RLS enabled deny-all on every `pos` table as backstop; a cross-tenant test per resource. Rejected: `set_config` RLS policies (unused in the repo; fragile with pooling).
- Analytics (`features.md #2`), PostHog server events: `pos_handoff_started`, `pos_store_created`, `pos_sale_completed`, `pos_shift_closed`; properties never carry names, phone numbers or amounts per customer.

## Implementation units

### U0. A deployed, empty POS service
Layer-only: every later unit needs the repo, the `pos` schema and a deploy before any behaviour can be shown.
Goal: `umkmall-pos`, started in the existing local folder `~/Documents/umkmall-pos` (empty, no git yet), pushed to `https://github.com/UMKMall/umkmall-pos` (private, empty, created 2026-11-17), with GPL-3 `LICENSE` + Lakasir attribution, `pos-api` health route, `pos-web` shell, CI, Railway service on `debian-slim` (Findings: base image). A dedicated role owns schema `pos` with `REFERENCES` on `public.users(id)` and no other `public` grant, applied by a UMKMall DB owner as a documented manual step with a check query (not a drizzle migration; Findings: Drizzle sees `public` only). POS CI builds against a fixture stub of `public.users`. The repo carries its own guard tests: one token verifier, no raw token or PII in logs, plus the CLAUDE.md trap list that applies to it.
Files: new repo; `docs/runbooks/pos-schema-role.md` (new); `packages/database/migrations/0058_enable_rls_public.sql` (read only).
Test: migration test asserts RLS on every `pos` table; guard tests above.
Invariants: `pos` objects never in `public`; UMKMall's migration runner ignores `pos`.
Proves: DoD repo-deploy, pos-role.
Slice check: `GET /health` on Railway answers 200, and the `pos` role is refused on `select` from any `public` table.

### U1. Owner signs in with UMKMall and gets an empty store
Goal: a link in UMKMall (flag `pos-enabled`, default OFF) starts the handoff. `apps/api` issues a ~5-minute token (asymmetric, `kid`, `aud: pos`, `sub` = `users.id`, `jti`) only for a live session and a flag-on user; it travels in a POST body, never a query or path, and is never logged. `apps/api` serves JWKS (current + previous key) and a liveness route for refresh. `pos-api` verifies, accepts each `jti` once, creates the tenant on first sight, and issues a 15-minute owner session refreshed through the liveness route. The owner sees an empty dashboard.
Files: `apps/api/src/auth/` (handoff, JWKS, liveness controllers + tests), `packages/shared/src/key-registry.ts`, `packages/config/src/env.ts`, `packages/config/src/key-env.test.ts`, `.env.example`, `docs/setup/environment-variables.md`, `turbo.json`, the link in `apps/main-website` (path set in U1's plan); POS auth + tenants modules; `docs/principles/architecture.md` (#4 exception), `docs/principles/domains.md` (POS domain, POS → Identity), `docs/architecture/pos-integration.md` (new), `docs/INDEX.md`.
Test: handoff refuses revoked session and flag-off user; second use of a `jti` refused; token signed under the legacy `JWT_SECRET` slot refused; refresh refused once the UMKMall session is revoked; `key-env.test.ts` covers the new credential.
Invariants: the HS256 key never leaves UMKMall; the flag is read server-side at handoff only, existing POS sessions are not re-gated (`features.md #1`).
Proves: DoD handoff, liveness, flag, docs.
Slice check: a flag-on test user clicks the link and sees the empty POS dashboard; a flag-off user gets 404.

### U2. Catalog: the owner adds categories and products
Goal: categories and products (name, SKU without spaces, barcodes, unit, cost and price in integer rupiah, type product/service/non-stock, images) through `pos-api` and `pos-web` screens styled with UMKMall token values. Images live in object storage under a per-tenant key prefix, served through the API, never by a public key.
Files: POS catalog module, migrations, screens, storage adapter.
Test: CRUD; cross-tenant: store B cannot list, read, update or delete A's product or image.
Invariants: tenant from the session only; RLS on new tables.
Proves: DoD catalog, isolation.
Slice check: create "Es Teh Manis" in store A; store B's list is empty and `GET` by A's id answers 404.

### U3. Cashier sells for cash inside a shift
Goal: open shift with opening cash → cart → cash payment with quick amounts → change → printable receipt → close shift with counted cash. The server computes every total; a sale needs an open shift and is linked to it; stock is decremented under a row lock; sale creation takes an idempotency key; oversell is refused.
Files: POS sales, shifts, stock modules; cashier and receipt screens.
Test: a client-sent price is ignored; two concurrent sales of the last unit sell one (lock held open, per the lock solution); a retry with the same key makes one sale; no open shift answers 422.
Invariants: integer rupiah; sale + stock + shift link in one transaction.
Proves: DoD cash-sale.
Slice check: sell 3 × Rp5.000 with Rp20.000 → change Rp5.000, stock 50 → 47, sale row carries the shift id.

### U4. Staff accounts, roles and the price override
Goal: the owner binds a cashier device to the store and creates cashiers (name + PIN) and roles with permissions; on a bound device a cashier picks their name and enters the PIN. A price override exists only for a permission, records the actor and stores the cost. The owner can revoke a device or a cashier session.
Files: POS users, roles, devices modules; user, role and PIN screens.
Test: override without permission answers 403; override sale stores cost and actor; PIN hashed; lockout per store + cashier with backoff; a revoked device cannot sign in.
Invariants: staff are tenant-scoped; no UMKMall account is created for them.
Proves: DoD staff.
Slice check: a cashier signs in by PIN on the bound device, the override control is hidden, and the API refuses it with 403.

### U5. Reports and dashboard tell the truth
Goal: dashboard (revenue, sales count, gross profit, period compare) and reports (sales, product, shift/cashier, export) with correct labels, the store's timezone and validated filters.
Files: POS reports module; dashboard and report screens.
Test: known-sales fixture: revenue = sum of totals, profit = revenue − cost; bad date or timezone answers 422.
Invariants: reads stay tenant-filtered.
Proves: DoD reports.
Slice check: after the U3 sale, the dashboard shows revenue Rp15.000 and profit Rp6.000.

### U6. Stock in: suppliers, purchasing and stock opname
Goal: suppliers; purchase orders with approval add stock batches (FIFO or "normal" per setting); stock opname adjusts stock with a reason and an approver.
Files: POS suppliers, purchasing, stock-opname modules; screens.
Test: an approved purchase adds a batch; FIFO draws from the oldest batch; an opname writes an adjustment row.
Invariants: stock changes only through the stock module, locked.
Proves: DoD purchasing.
Slice check: buy 20 → stock 47 → 67; opname to 65 shows −2.

### U7. Members, vouchers and credit sales
Goal: members; vouchers (percentage or flat, minimum, quota, dates) applied inside the sale transaction; tax on the amount after discounts; credit sale ("kasbon") creates a receivable; payments reduce it. Member data is the store's customers' PII: classified, minimised, and erased with the store.
Files: POS members, vouchers, receivables modules; screens.
Test: a quota-1 voucher works once and a failed sale does not consume it; tax-after-discount fixture with expected rupiah; credit sale without client prices creates a receivable; a partial payment leaves the remainder.
Invariants: voucher quota and receivable balance change only inside locked transactions (`data-security.md #4`).
Proves: DoD voucher-credit.
Slice check: credit sale Rp6.000 to "Bu Sari", pay Rp2.500 → remaining Rp3.500.

### U8. Erasing a UMKMall account erases its store
Goal: when UMKMall archives a deleted account (or the UMK-1495 purge runs), `apps/api` calls an authenticated internal `pos-api` purge, or writes a tombstone the POS consumes; the POS deletes every `pos` row and image for that tenant before the archival completes. The `ON DELETE RESTRICT` FK makes a skipped purge fail loudly.
Files: `apps/api/src/auth/account-delete-service.ts`, its test, the archival function's migration in `packages/database/migrations/` (risky path; the U8 plan names it); POS purge module.
Test: through the real archive path, a user with a store ends with no `pos` rows and no images; a POS outage makes archival retry, not skip.
Invariants: `data-security.md #5`; deletion stays behind `user_deletion_enabled`; coordinate with the UMK-1495 owner.
Proves: DoD erasure.
Slice check: archive a deleted test account locally; `select count(*) from pos.tenants where user_id = …` is 0.

### U9. QRIS payment (after v1, gated by legal)
Goal: only after written legal/BI sign-off: a Xendit xenPlatform sub-account per store, a QRIS charge at the cashier, its own webhook URL and token (never the invoice callback; Findings: unknown invoices are dropped), settlement linked to the sale.
Files: decided in its own plan (`packages/payments/` or the POS repo); `apps/api/src/payments/xendit-webhook.controller.ts` (read only).
Test: webhook token check, idempotent settlement, underpayment refused.
Invariants: integer rupiah; no secret in a URL path.
Proves: DoD qris.
Slice check: Xendit test-mode QRIS paid → sale marked paid.

## Files

UMKMall monorepo: `apps/api/src/auth/` (handoff, JWKS, liveness + tests), `apps/api/src/auth/account-delete-service.ts`, `packages/database/migrations/` (U8 archival hook), `packages/shared/src/key-registry.ts`, `packages/config/src/env.ts`, `packages/config/src/key-env.test.ts`, `.env.example`, `docs/setup/environment-variables.md`, `turbo.json`, `apps/main-website` (store link), `docs/principles/architecture.md`, `docs/principles/domains.md`, `docs/architecture/pos-integration.md` (new), `docs/runbooks/pos-schema-role.md` (new), `docs/INDEX.md`, `packages/database/migrations/0058_enable_rls_public.sql` (read only), `apps/api/src/payments/xendit-webhook.controller.ts` (read only), `packages/payments/` (U9, decided later).
New repo `umkmall-pos`: `pos-api` (auth, tenants, catalog, storage, sales, shifts, stock, users/roles/devices, reports, suppliers, purchasing, stock opname, members, vouchers, receivables, purge), `pos-web`, migrations in schema `pos`, guard tests, CI, Dockerfile, `LICENSE` + attribution.

## Definition of Done

Where: (M) checked in this monorepo, (P) checked in `umkmall-pos`.
- [cmd] repo-deploy — (P) CI green (lint, typecheck, tests, guard tests); `LICENSE` GPL-3 with Lakasir attribution. (U0)
- [cmd] pos-role — (P) migration test: RLS on every `pos` table; the `pos` role is refused on `public` reads. (U0)
- [test] handoff — (M) handoff refuses revoked and flag-off; (P) `jti` replay refused, legacy-slot token refused; (M) `key-env.test.ts` passes. (U1)
- [test] liveness — (M)+(P) a revoked UMKMall session cannot refresh the POS session. (U1)
- [manual] flag — PostHog `pos-enabled` created default OFF; it stays OFF for real users until erasure is done. (U1, U8)
- [cmd] docs — (M) `docs/INDEX.md` lists `pos-integration.md` and `pos-schema-role.md`; `architecture.md #4` and `domains.md` carry the POS exception and row. (U0, U1)
- [test] isolation — (P) every POS resource has a cross-tenant test answering 404/403. (U2–U7)
- [test] catalog — (P) product CRUD and image access per tenant. (U2)
- [test] cash-sale — (P) server totals, last-unit concurrency, idempotent retry, open-shift rule. (U3)
- [test] staff — (P) override permission, cost and actor stored, PIN lockout, device revoke. (U4)
- [test] reports — (P) revenue/profit fixture; bad filters answer 422. (U5)
- [test] purchasing — (P) purchase adds a batch, FIFO draw, opname adjustment. (U6)
- [test] voucher-credit — (P) quota-1 voucher once, tax after discounts, credit sale and partial payment. (U7)
- [test] erasure — (M)+(P) real archive path leaves no `pos` rows or images. (U8)
- [manual] qris — deferred: no work until legal/BI sign-off is recorded. (U9)
- [qa] live — Live test: recipe `api-call` for the U1 handoff on the local stack, and recipe `ui-flow` per POS unit on its preview (exists after U0): sign in from UMKMall → catalog → shift → cash sale → reports; screenshots in `.evidence/`.
- [cmd] verify — (M) `npx turbo typecheck`, `npx turbo lint`, `npx turbo test --filter='!@umkmall/mobile'` pass for every monorepo-side unit.

## Verification

Monorepo units run the three config `verify` commands plus their own tests; POS units run that repo's CI and a `ui-flow` on its preview. Not exercisable today: the POS preview (no repo yet), Xendit xenPlatform (no sub-account credentials), production cookies on `*.umkmall.id`.

## Rollout

U0 → U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8. The flag opens to internal accounts after U1 and to real users only after U8. New env vars for the handoff key pair and `kid` (U1). The `pos` role and grant exist before the POS's first migration (U0). `pr-base` hard-codes 8 services (Findings: PR envs); U0 decides whether the POS joins it or keeps its own preview. U9 waits for legal.

## Rulings

- 2026-11-17 owner (chat): separate repo, schema `pos` in the same Postgres, direct GPL-3 port, v1 scope, handoff token, tenant = `users.id` → Approach, U0–U9.
- 2026-11-17 plan review: cascade replaced by explicit erasure with `RESTRICT`; handoff `jti` single-use in a POST body; legacy slot refused; grant as a manual step with a stub in POS CI; Nest CLI build; image storage in U2; analytics named; DoD keyed to Proves → U0, U1, U2, U8.
- 2026-11-17 owner (chat): 15-minute owner session with liveness refresh; device-bound cashier PIN → U1, U4.
- 2026-11-17 owner (chat): units run in parallel sessions that push straight to `umkmall-pos` `main` (no PR review there; CI gate); monorepo changes keep the monorepo PR process → CLAUDE.md.
- 2026-11-17 U0 landed: NestJS (tsc, Jest), Drizzle in schema `pos`, own migration runner (drizzle's migrator needs database-level CREATE, which `pos_app` must not have), global session guard + `@CurrentSession`, `ops/pos-role.sql`, CI. Railway service and the real `pos_app` role are still owner steps → U0.
- 2026-11-17 U2 landed: `pos.categories`, `pos.products` (SKU unique per tenant among live rows, generated without spaces; `cost_price`/`selling_price` integer rupiah, cost ≤ selling; type product/service/non_stock; soft delete), `pos.product_barcodes`, `pos.product_images` (key `tenants/<id>/products/<pid>/…`, local-disk `ObjectStorage` via `POS_STORAGE_DIR`, magic-byte type check, served only through the API); writes gated on `catalog.manage`; `pos-web` catalog screens. No stock columns: U3/U6 key stock by `products.id`. Not done: S3 adapter, image UI, price units → U2.
- 2026-11-17 U4 landed (permission + guard; the override sale is U3): `pos.staff` (scrypt PIN, soft delete), `pos.roles` (Pemilik/Kasir seeded on first use), `pos.role_permissions` (code-defined keys `sales.create`, `sales.price_override`, `catalog.manage`, `reports.view`, `staff.manage`), `pos.staff_roles`, `pos.devices` (sha256 secret, revoke), `pos.staff_sessions`, `pos.pin_attempts` (5 failures → 30 s doubling to 15 min, row-locked). Cashier token claim `csid`; the session guard checks it is live and loads permissions per request; `@RequirePermission` / `hasPermission` (CLAUDE.md Rules). `pos-web` `/staf`, `/staf/peran`, `/staf/perangkat`, `/kasir/masuk`; device token in an httpOnly cookie on the device. Not done: staff audit log, cashier redirect to `/kasir/masuk` when their session ends → U4.

## Risks and deferred

- **GPL-3 and `@umkmall/ui`:** bundling UMKMall's UI package into a GPL-3 web app served to browsers may put that package under GPL terms. Default: `pos-web` imports no `@umkmall/*` and reuses token values only. Legal to confirm before U2.
- **Escrow is a licensed activity:** holding merchant funds needs a BI licence or a licensed PJP's sub-merchant model. U9 does not start without written sign-off.
- **Shared Postgres across two repos:** a POS migration mistake can hit UMKMall's database, and a backup restore restores both; mitigated by the least-privilege role (U0). Revisit a separate database if the POS is sold standalone.
- **UMK-1495 purge is unbuilt** (Findings: purge unbuilt): U8 either hooks the archival that exists or lands with UMK-1495; its plan decides with that owner.
- lakasir-findings.md says "no Lakasir code"; under the settled direct port that line no longer applies.
- Deferred: UMKMall web and mobile integration over the API, multi-outlet, F&B tables, offline cashier, product import and label printing, hardware printers, Lakasir's unfinished PosV2 screen (lakasir-findings.md 6; port the classic cashier).
- 2026-11-17 owner: everything lives in ONE ticket, UMK-1924 (no sub-issues); each unit still gets its own `/team-plan` under that id.
- 2026-11-17 owner: the POS repository is `UMKMall/umkmall-pos` (private) → U0.
