# UMK-1963 follow-up: cash kasbon instalments without an open shift, store cash ledger (server part)

Epic UMK-1924, unit U7. Follows `2026-11-24-002` (shift cash ledger). Owner rulings of 24 Nov 2026:
1. Staff who hold only `receivables.manage` (they cannot open a shift, which needs `sales.create`) may
   accept a cash kasbon instalment without an open shift. Kasbon cash instalments stay unrounded.
2. That cash is reported and recorded into the store's cash ("kas toko").
3. An actor who CAN open a shift (holds `sales.create`; an owner holds every permission) must still open
   one to take cash: 422 "Buka shift dulu sebelum menerima pembayaran tunai".
4. A void of a kasbon sale pays every cash instalment back from the drawer open now (no change).

## Goal
`POST /receivables/:id/payments` with a cash method:

| The actor | Result |
|---|---|
| has an open shift | unchanged: a `receivable_payment` entry in that shift's ledger, expected cash up |
| has no open shift, holds `sales.create` (or is the owner) | 422, nothing changes, the key is not claimed |
| has no open shift, cannot open one | 201: the payment is marked `collected_outside_shift` and a store cash `in` entry is written |

A cash payment is therefore in exactly one ledger: a shift's or the store's.

## Schema
- Migration `0020`: `pos.receivable_payments.collected_outside_shift boolean not null default false`, the
  explicit marker. The shift link is not stored twice: a payment taken in a shift is linked by its
  `pos.shift_cash_entries` row (`kind = 'receivable_payment'`, `ref_id` = the payment). Who collected it
  and when are the row's `actor_id`, `actor_kind`, `created_at`; payment rows are append-only.
- Migration `0021`: `pos.store_cash_entries` (`tenant_id` FK to `pos.tenants`, `direction` in/out, `kind`,
  `amount` > 0, `ref_id`, `note`, `actor_id`, `actor_kind`, `created_at`; RLS; unique
  `(tenant_id, kind, ref_id)` so one source row has one entry). Balance = Σ in − Σ out. The migration also
  enters the outside-shift payments recorded between `0020` and `0021` (none in production).
  The purge covers the table (it has `tenant_id`; the purge test's seed reaches it).

## Behaviour
- Store cash rows are inserted only by `recordStoreCash` (`src/store-cash/store-cash-ledger.ts`; guard in
  `src/guards.spec.ts`), inside the payment's transaction, and never updated or deleted. The one kind
  today is `receivable_payment` (in). Later writers call the same function with a new kind and need no
  migration: supplier payments and expenses paid from the store cash, a void paid back from it, and a
  handover between the store cash and a drawer or the bank (out). None is built here.
- The choice of ledger is made once, in the payment's transaction, under the receivable row lock and then
  the actor's open-shift row lock (`recordShiftCashIfOpen` in `src/shifts/cash-ledger.ts`, still the only
  writer of the shift ledger).
- Races, for an actor who can open a shift: a payment that reaches the shift's lock before the close is
  counted in that close; one that reaches it after is refused (422). A payment in flight while the shift
  opens lands in that shift once the open has committed, and is refused before.
- An `Idempotency-Key` replay returns the first result and writes nothing, also when the collector later
  gets `sales.create` and opens a shift: an outside-shift payment never moves into a shift.
- An actor without `sales.create` who nevertheless has an open shift (the permission was withdrawn
  mid-shift) still pays into that shift.
- Non-cash methods: unchanged (no shift, no ledger entry, no marker). Amounts are not rounded.
- Tenant isolation: `tenantId` from the session on every query, the store cash reads included.

## Void of a kasbon sale with an outside-shift instalment (owner: keep)
No special case: every cash instalment of the voided sale is given back in cash out of the drawer of the
shift the voiding actor has open NOW, as one `void_refund` ledger entry; without an open shift the void
answers 422 "Buka shift dulu untuk membatalkan struk tunai" and changes nothing. Consequences: that
shift's expected cash drops by an amount it never received, and the store cash keeps the instalment's
`in` entry (the store cash still holds that money; the drawer paid the customer). The void's return row
carries `collectedOutsideShift: true` so a reader of the shift can see why. The payment row and the store
cash entry are never changed by the void.

## Reporting (no new screen)
- `GET /store-cash?page&perPage` (permission `reports.view`): entries newest first (`direction`, `kind`,
  `amount`, `refId`, `note`, `actorId`, `actorKind`, `actorName`, `createdAt`), `total`, and `summary`
  `{ cashIn, cashOut, balance }` over the whole ledger. `reports.view` and not `receivables.manage`: what
  the whole store holds is a money report; a collector sees their collections on the receivables.
- `GET /receivables/:id` payment rows gain `collectedOutsideShift`, `shiftId` (the shift whose ledger has
  the payment, else null), `actorId`, `actorName`.
- Receivable rows (`GET /receivables`, `GET /receivables/:id`) gain `outsideShiftCollected`; the list
  `summary` gains `outsideShiftCollected` over the search (any status, like `openRest`).
- `GET /sales/:id/void` return rows gain `collectedOutsideShift`.
- Shift responses and `/reports/shifts` do not change: these payments are in no shift.

## Definition of Done
- [test] A collector (only `receivables.manage`, 403 on `/shifts/open`) takes cash: 201, rest down,
  payment marked with collector and time, one store cash `in` entry with the payment as `ref_id`, no shift
  ledger entry; the owner's open shift and a shift opened afterwards do not count it, live and at close.
- [test] The owner, and a cashier with `sales.create` + `receivables.manage`, without an open shift: 422,
  no payment, no ledger row of either kind, rest unchanged; the same key succeeds once a shift is open.
- [test] A cash payment with an open shift is unchanged: shift ledger entry, marker `false`, no store cash.
- [test] `GET /store-cash`: entries, paging, totals and balance; 403 without `reports.view`; 422 on bad paging.
- [test] A replayed key returns the first result and writes nothing, also once the collector has a shift.
- [test] Deterministic races (the test holds the row lock and releases it when the requests are queued):
  payment before close is counted; payment after close is refused; payment in flight during the open
  lands in the new shift; an uncommitted shift does not count.
- [test] Non-cash payments and down payments are neither outside-shift nor store cash.
- [test] Void of a kasbon sale with an outside-shift instalment: 422 without an open shift, with one the
  cash leaves that drawer, the return row says `collectedOutsideShift`, the store cash is unchanged.
- [test] Cross-tenant: store B gets 404 paying store A's receivable; B's receivables and store cash show
  nothing of A, and the other way round.
- [test] Guards: RLS and `tenant_id` (`db.e2e-spec`, `purge.e2e-spec`); store cash is inserted only in
  `store-cash-ledger.ts`.
- [test] Revert-red, once each: without the store cash write; without the `sales.create` rule; with an
  insert outside `store-cash-ledger.ts`.
- [cmd] `npm run lint && npm run typecheck && npm run build`, `PGTEST_DB=pos_u1963b npx jest --runInBand`.
- [qa] Screens (receivable label and amount, a store cash page): not done here (server only).

## Follow-ups (tracked, not built)
- **Handover / deposit step, needed before real cash:** a collector hands the cash to the owner, a drawer
  or the bank (store cash `out`, or a transfer into a shift), with a per-collector list of what is still
  outstanding. Until then the store cash balance only grows and says nothing about who holds the money.
- **Summary query cost:** `outsideShiftCollected` in the receivables list and its summary is a correlated
  subquery per receivable over the whole search; give it a partial index on
  `receivable_payments (tenant_id, receivable_id) where collected_outside_shift` or a stored total when
  lists get large. `GET /store-cash` sums the whole ledger per request; a date filter comes with its screen.
- **Gating `actorId` / `shiftId` in payment rows:** every `receivables.manage` holder now sees which
  colleague collected and in which shift; decide whether those two need `reports.view`.
- Other store cash writers: supplier payments, expenses, void paid from the store cash (UMK-1970,
  UMK-1984, UMK-1962).

## Files
- `apps/pos-api/src/db/schema/receivables.ts`, `db/schema/store-cash.ts`, `db/schema/index.ts` (one line),
  `drizzle/0020_*.sql`, `drizzle/0021_*.sql`.
- `apps/pos-api/src/store-cash/store-cash-ledger.ts` (the writer), `store-cash.controller.ts` (read
  service, controller, module), `app.module.ts` (one line).
- `apps/pos-api/src/shifts/cash-ledger.ts` (`recordShiftCashIfOpen`).
- `apps/pos-api/src/receivables/receivables.controller.ts` (`pay`, `get`, `list`).
- `apps/pos-api/src/void/void.service.ts` (return rows show the marker).
- `apps/pos-api/src/guards.spec.ts`.

## Tests
`apps/pos-api/test/shift-cash.e2e-spec.ts`, `test/void.e2e-spec.ts`, `test/members.e2e-spec.ts`,
`test/purge.e2e-spec.ts` (seed), `test/members-paging.e2e-spec.ts` (summary shape).
