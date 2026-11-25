# UMK-1924 U3 / UMK-1963: manual drawer cash in/out, store cash handover (server part)

Epic UMK-1924, unit U3. Follows `2026-11-24-002` (shift cash ledger) and `2026-11-24-006` (store cash
ledger; its follow-up "Handover / deposit step, needed before real cash"). Owner rulings that bind this
change: cash taken outside a shift is reported and recorded into the store's cash; staff who hold
`sales.create` must still open a shift; an agent can NEVER take cash out of a drawer.

Server only. No pos-web screen changes (one label line for the new permission).

## What the approved designs say
Both design pages were read in full (`Desain P0 UMKMall POS`, `Desain Fitur Lanjutan POS`). **Neither has a
"kas masuk / kas keluar" screen nor a handover ("setor / serah terima") screen.** What they do fix:
- Tutup shift (fitur 4): expected cash = opening cash + cash sales + kasbon cash − drawer expenses − void
  returns. Manual movements add to the same sum through the ledger's `cashIn` / `cashOut`.
- More than the drawer holds: an expense warns and saves (fitur 1), a void warns (fitur 6), a supplier
  payment from the drawer is **refused** (fitur 10).
- A reason is picked from a fixed list, and "Lainnya" needs a note (fitur 6); a note is optional, 200
  characters (fitur 1).
- Agent (fitur 7): "tidak catat uang keluar laci".

Where the designs are silent this plan takes the most conservative reading and lists it under
**Open questions for the owner**.

## Goal
1. A cashier records cash put into or taken out of the open drawer that is not a sale, a kasbon payment, an
   expense or a void return (extra float, a bank deposit, the owner taking cash), with a reason, and the
   shift's expected cash follows.
2. A collector's outside-shift cash is handed over to the store safe: the hand-over is audited (who handed
   over, who received, how much, note), and the store can see per collector what is still outstanding.

## 1. Manual drawer cash: `POST /shifts/current/cash-entries`
- Permission `sales.create`; header `Idempotency-Key` (required, 8–100 of `[A-Za-z0-9_-]`).
- Body (strict): `{ direction: 'in' | 'out', amount: integer rupiah > 0, reason, note? }`.
  `reason` is a fixed list per direction (`GET /shifts/cash-entry-reasons`): in `tambah_modal`, `lainnya`;
  out `setor_bank`, `ambil_pemilik`, `lainnya`. `lainnya` needs a note. Note ≤ 200 characters.
- Needs the actor's open shift: 422 "Buka shift dulu untuk mencatat kas masuk atau keluar" otherwise.
- **Cash-out larger than the drawer's expected cash is refused** (422 on `amount`), nothing is written.
  The check runs under the shift's row lock, so two cash-outs cannot together overdraw.
- Written as one `pos.manual_cash_entries` row (reason, note, drawer cash before, idempotency key and
  request hash) plus one shift ledger row of the new kind `manual_in` / `manual_out` with that row as
  `ref_id`, in one transaction. The ledger row is inserted by `recordShiftCash` in
  `src/shifts/cash-ledger.ts`, still the only writer of the ledger.
- A replayed key returns the first entry and writes nothing, also after the shift closed; the same key with
  another body is refused (422 on `idempotencyKey`).
- Shift responses gain `manualIn` and `manualOut` (parts of `cashIn` / `cashOut`); `GET /shifts/:id`
  `cashEntries` rows gain `reason` and `reasonLabel` (null for the other kinds); `/reports/shifts` rows gain
  `manualIn`, `manualOut` (CSV unchanged: its "Kas masuk" / "Kas keluar" columns already hold them).
- **Agent sessions.** `src/tenancy/session.ts` knows two session kinds today, `owner` and `cashier`; an
  `agent` kind does not exist yet (UMK-1983). The ledger therefore refuses every `out` entry (a manual
  cash-out, a drawer expense, a void return) for a session kind that is not on the allow-list
  `DRAWER_CASH_OUT_ACTOR_KINDS` (`owner`, `cashier`): 403, before any query. A new kind is refused until
  someone adds it to that list on purpose.

## 2. Store cash handover: `POST /store-cash/deposits`
Semantics (from plan `006`): the store cash ledger already takes an `in` entry at the moment a collector
takes cash outside a shift, so the store's balance already counts that money; what is unknown is who holds
it. A deposit records that the collector's cash reached the store safe. It is therefore a **`transfer`**
in the store ledger (a new direction: holder changes, balance does not), never a second `in`.

- New permission `store_cash.manage` (owners hold it; a role may be given it). The **receiver** records the
  deposit and names the collector.
- Header `Idempotency-Key`; body (strict) `{ collectorId: uuid (a staff id), amount: integer rupiah > 0,
  note? }`.
- A collector's outstanding = Σ their outside-shift collections (store ledger `in`, kind
  `receivable_payment`, their actor id) − Σ deposits in their name. `amount` above the outstanding is
  refused (422 on `amount`), under the collector's staff row lock (`select … for update`), so concurrent
  deposits cannot hand over more than was collected.
- The receiver cannot be the collector (422 on `collectorId`): nobody clears their own outstanding.
- A staff id of another store, or unknown: 404. A staff member of this store with nothing outstanding: 422.
- Written as one `pos.store_cash_deposits` row (collector, receiver, amount, note, outstanding before, key,
  hash) and one store ledger row (`direction: 'transfer'`, `kind: 'collector_deposit'`, `ref_id` = the
  deposit) through `recordStoreCash`, in one transaction. A replayed key returns the first deposit.
- `GET /store-cash` (`reports.view`) gains `collectors` (`collectorId`, `collectorKind`, `collectorName`,
  `collected`, `handedOver`, `outstanding`) and `summary.outstanding` / `summary.handedOver`;
  `cashIn`, `cashOut`, `balance` do not move on a deposit.
- `GET /store-cash/collectors` (`store_cash.manage`): the same per-collector rows, for the receiver.
- `GET /store-cash/deposits?page&perPage` (`reports.view`): the audit list, newest first.
- A void of a kasbon sale keeps not touching the store ledger (plan `006`), so it does not change anyone's
  outstanding.

Not built: handing a closed shift's surplus to the safe, the safe paying into a drawer or a bank, expenses
from the safe (no design, no plan; see open questions).

## Schema (two generated migrations: `0027` manual cash, `0028` deposits)
- `pos.manual_cash_entries`: `tenant_id` FK, `(tenant_id, shift_id)` FK to `pos.shifts`, `direction`,
  `reason`, `note`, `amount` > 0, `drawer_cash_before`, actor, `idempotency_key` unique per tenant,
  `request_hash`, `created_at`. RLS. Append-only.
- `pos.store_cash_deposits`: `tenant_id` FK, `(tenant_id, collector_id)` FK to `pos.staff`, `amount` > 0,
  `note`, `outstanding_before`, `received_by_id`, `received_by_kind`, `idempotency_key` unique per tenant,
  `request_hash`, `created_at`. RLS. Append-only.
- `pos.store_cash_entries`: the direction check also allows `transfer`.
- Ledger kinds `manual_in`, `manual_out` (shift) and `collector_deposit` (store) are text values: no column
  change. The purge reaches both tables (they have `tenant_id`; the purge test's seed fills them).

## Definition of Done
- [test] Cash in and cash out with an open shift: 201, expected cash moves live and at close, `manualIn` /
  `manualOut` in the shift, the entry with reason and note in `GET /shifts/:id`.
- [test] No open shift: 422, nothing written, the key is not claimed. Without `sales.create`: 403.
- [test] Cash-out above the drawer's expected cash: 422, nothing written; exactly the expected cash passes.
- [test] Two concurrent cash-outs that together exceed the drawer: one 201, one 422 (deterministic: the test
  holds the shift's row lock until both wait).
- [test] Validation: amount 0, negative, float, string; unknown direction or reason; a reason of the other
  direction; `lainnya` without a note; unknown field; missing or malformed `Idempotency-Key`: all 422.
- [test] Idempotent: a replay returns the first entry and one ledger row, also after the shift closed; the
  same key with another body is 422; two concurrent requests with one key write one entry.
- [test] Cross-tenant: store B's key replay never returns store A's entry; B gets 404 on A's shift; a
  cashier without `reports.view` gets 404 on another actor's shift and its entries.
- [test] Agent: a session kind outside the allow-list is refused for every ledger `out` entry before any
  query, and allowed for `in` (unit test on `cash-ledger.ts`; revert-red).
  - [manual] When the `agent` session kind is added (UMK-1983): an e2e test that an agent token gets 403 on
    `POST /shifts/current/cash-entries` with `direction: 'out'`, on a drawer expense and on a cash void.
- [test] Deposit: 201, the collector's outstanding goes down, the audit row names collector and receiver,
  the store ledger has one `transfer` row, `cashIn` / `cashOut` / `balance` unchanged.
- [test] Deposit above the outstanding: 422, nothing written; exactly the outstanding passes; after that
  422.
- [test] Two concurrent deposits that together exceed the outstanding: one 201, one 422 (deterministic, the
  test holds the collector's staff row lock).
- [test] Deposit permissions: 403 without `store_cash.manage` (also for the collector and for a
  `reports.view` holder); the receiver cannot be the collector (422).
- [test] Deposit idempotency: replay returns the first deposit, one row; another body with the key is 422.
- [test] Deposit validation: 422 on bad amount, bad collector id, unknown field, missing key.
- [test] Cross-tenant: store B gets 404 depositing for store A's collector and A's outstanding is
  unchanged; B's `GET /store-cash`, `/collectors`, `/deposits` show nothing of A.
- [test] `GET /store-cash` lists per-collector collected / handed over / outstanding for several collectors.
- [test] Guards: both tables have RLS and `tenant_id` (`db.e2e-spec`, `purge.e2e-spec` with seed);
  `pos.manual_cash_entries` and the kinds `manual_in` / `manual_out` are written only in
  `shifts/cash-entries.service.ts`; `pos.store_cash_deposits` and the kind `collector_deposit` only in
  `store-cash/store-cash-deposits.service.ts`; both ledgers still only in their ledger files.
- [test] Revert-red, once each: the overdraw check of the cash-out; the shift lock before the key check
  (a duplicate in flight); the outstanding check of the deposit; the staff row lock of the deposit; the
  agent allow-list (the check removed from a writer, and `agent` added to the list); an insert outside the
  two service files.
- [cmd] `npm run lint && npm run typecheck && npm run build`, `PGTEST_DB=pos_cash npx jest --runInBand`
  in `apps/pos-api`.
- [qa] Screens (kas masuk/keluar form, handover form, per-collector list, the two lines on tutup shift):
  not done here; they wait for an approved design.

## Open questions for the owner
1. **Cash-out above the drawer's expected cash: refused.** The designs warn for an expense and a void and
   refuse for a supplier payment; there is no kas keluar screen. Refusal is the stricter reading. If a
   warning is wanted, the entry already stores `drawerCashBefore` to show it.
2. **The reason lists** (in: Tambah modal laci, Lainnya; out: Setor ke bank, Diambil pemilik, Lainnya) are a
   proposal; no design names them.
3. **Who records a handover:** the receiver, with the new permission `store_cash.manage`, never the
   collector alone. Should the collector also confirm (a PIN, as a void needs)?
4. **Manual cash-out needs only `sales.create`** (the task's ruling). A void and a discount above 30% need
   an admin PIN; should a cash-out too?
5. **A closed shift's surplus to the safe** and **"setor ke bank" as a store cash movement**: not built. A
   drawer cash-out with reason `setor_bank` leaves the POS's books; it is not entered into the store cash.
6. **A void of a kasbon sale with an outside-shift instalment** pays the customer from a drawer and leaves
   the collector's outstanding as it was (plan `006`): the collector still owes that cash to the safe.
7. A collector who was removed (soft-deleted staff) keeps an outstanding amount and can still be named in a
   deposit; nothing writes it off.

## Files
- `apps/pos-api/src/db/schema/shift-cash.ts`, `db/schema/store-cash.ts`, `drizzle/0027_*.sql`,
  `drizzle/0028_*.sql` (generated).
- `apps/pos-api/src/shifts/cash-ledger.ts` (kinds, totals, the agent allow-list),
  `shifts/cash-entries.service.ts` (new), `shifts.controller.ts`, `shifts.service.ts`, `shifts.module.ts`.
- `apps/pos-api/src/store-cash/store-cash-deposits.service.ts` (new), `store-cash.controller.ts`.
- `apps/pos-api/src/staff/permissions.ts` (one key), `reports/reports.service.ts` (two totals),
  `src/guards.spec.ts`.
- `apps/pos-web/src/routes/staf/-api.ts` (the permission's label, one line).
- `commitlint.config.js` (scope `store-cash`).

## Tests
`apps/pos-api/test/cash-entries.e2e-spec.ts`, `test/store-cash-deposits.e2e-spec.ts` (new),
`src/shifts/cash-ledger.spec.ts` (new, the agent allow-list), `src/guards.spec.ts`,
`test/purge.e2e-spec.ts` (seed); `test/shift-cash.e2e-spec.ts` and `test/void.e2e-spec.ts` (the store cash
`summary` now also has `outstanding` and `handedOver`).
