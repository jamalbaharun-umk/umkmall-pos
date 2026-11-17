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
- **UMKMall monorepo changes** (U1 handoff/JWKS/liveness, U8 erasure hook) go through the monorepo's own
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
- **Gate actions with `@RequirePermission('<key>')`** (`src/staff/require-permission.ts`; keys in
  `src/staff/permissions.ts`, add new ones there). Owners hold every permission; a cashier holds their roles'
  permissions, loaded per request by the session guard (`session.permissions`). Inline checks use
  `hasPermission(session, key)` (U3: a client price counts only with `sales.price_override`).
- **Validate at the boundary with zod;** a bad input answers 422 (never 500). Errors never echo internals.
- **POS tokens are signed and verified only in `src/tenancy/session.ts`** (guard test). The POS never holds
  UMKMall's `auth_token` HS256 key; UMKMall sign-in arrives as a handoff token (U1).
- **No `console`** in `src/` (lint + guard). Never log tokens, PINs, phone numbers or customer names.
- **Erasure:** the tenant FK to `public.users` is `ON DELETE RESTRICT`; a store is erased by the U8 purge,
  which must cover every new table and every stored image. `POST /internal/tenants/purge` (`src/purge/`)
  deletes every `pos` table with a `tenant_id` column, discovered at runtime, so a new table needs `tenant_id`
  (guard in `test/purge.e2e-spec.ts`; only `tenants` and `handoff_jtis` are exempt) and its images under
  `tenants/<tenantId>/`. UMKMall's archival (role `postgres`) reads `pos.tenants (id, user_id)` to wait for the
  purge (migration `0012`); grant it nothing more.
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

## Commands

```bash
npm install                     # once, at the repo root
npm run db:up                   # local Postgres on :5544 (docker compose)
npm test                        # pos-api: unit + e2e against a fresh pos schema
npm run db:generate -w pos-api  # new migration from schema changes
npm run dev -w pos-web          # http://localhost:3101
```

`pos-api` needs `DATABASE_URL` (the `pos_app` role), `POS_SESSION_SECRET` (≥ 32 chars), `UMKMALL_JWKS_URL`
(`{UMKMall API}/.well-known/pos-jwks.json`), `UMKMALL_API_URL` (liveness base) and `POS_SERVICE_KEY` (same value as
UMKMall's) in its environment. `pos-web` needs `POS_API_URL`.

**Signing in locally without UMKMall** (refused when `NODE_ENV=production`): create a stub UMKMall user in your
database, then start `pos-web` with `POS_DEV_USER_ID` set to it and press "Masuk (pengembangan)" on `/`
(`POST /masuk/dev` → pos-api `POST /auth/dev/sign-in`). The dev session has no UMKMall `sid`, so it cannot refresh:
sign in again after 15 minutes. Screens call pos-api through `api()` in `apps/pos-web/src/lib/api.server.ts`.

```bash
docker compose exec postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"
POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<that id> npm run dev -w pos-web
```
The `pos_app` role and `pos` schema are created once per environment by a UMKMall DB owner: `ops/pos-role.sql`.
