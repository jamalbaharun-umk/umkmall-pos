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
- **Validate at the boundary with zod;** a bad input answers 422 (never 500). Errors never echo internals.
- **POS tokens are signed and verified only in `src/tenancy/session.ts`** (guard test). The POS never holds
  UMKMall's `auth_token` HS256 key; UMKMall sign-in arrives as a handoff token (U1).
- **No `console`** in `src/` (lint + guard). Never log tokens, PINs, phone numbers or customer names.
- **Erasure:** the tenant FK to `public.users` is `ON DELETE RESTRICT`; a store is erased by the U8 purge,
  which must cover every new table and every stored image.
- **Licence:** keep `LICENSE`/`NOTICE`. `pos-web` imports no `@umkmall/*` package (open GPL question); reuse
  UMKMall token values only (`apps/pos-web/src/styles/app.css`).
- **Copy is Indonesian,** every screen has loading, empty and error states.

## Commands

```bash
npm install                     # once, at the repo root
npm run db:up                   # local Postgres on :5544 (docker compose)
npm test                        # pos-api: unit + e2e against a fresh pos schema
npm run db:generate -w pos-api  # new migration from schema changes
npm run dev -w pos-web          # http://localhost:3101
```

`pos-api` needs `DATABASE_URL` (the `pos_app` role) and `POS_SESSION_SECRET` (≥ 32 chars) in its environment.
The `pos_app` role and `pos` schema are created once per environment by a UMKMall DB owner: `ops/pos-role.sql`.
