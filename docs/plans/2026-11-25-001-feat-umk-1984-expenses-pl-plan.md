# UMK-1984: expense log and simple profit and loss report (server part)

Epic UMK-1924, unit U5 (reports). Design approved by the owner on 2026-11-24 (tab 1 "Pengeluaran & laba
rugi" of the P0 design, plus the money-source toggle). This plan covers pos-api only; the screens are a
separate change.

## Goal
The owner (or staff with `expenses.manage`) records what the store paid out, and sees a profit and loss
report in everyday words: sales − cost of goods = gross profit; gross profit − expenses = net profit.

## Rulings used
- An expense has an amount (integer rupiah > 0), a category from a fixed list, an optional note, a date and
  a money source.
- Categories: `bayar_pemasok` (Bayar pemasok), `listrik_air` (Listrik & air), `sewa` (Sewa), `gaji` (Gaji),
  `transport` (Transport), `lainnya` (Lainnya).
- **A supplier payment is its own record kind** (`kind = 'supplier_payment'` ⇔ category `bayar_pemasok`,
  a check constraint). It is listed, it can take cash out of a drawer, and it is never an expense of the
  profit and loss report: the goods' cost is already cost of goods sold.
- Source `drawer` ("Laci kasir"): cash leaves the actor's OPEN shift now; without an open shift 422. The
  date is today (store timezone); another date is refused. An amount above the drawer's expected cash is
  allowed and flagged (`exceedsDrawerCash`), as the design warns and does not block.
- Source `outside` ("Di luar laci"): no drawer effect; the date defaults to today, may be in the past,
  never in the future.
- Revenue: superseded by the owner ruling of 2026-11-25 (plan `2026-11-25-003`): tax is held for
  remittance, so this report's revenue is Σ sale totals − tax and no profit holds tax. (Before: Σ sale
  totals, tax included.) Kasbon sales are revenue. Cash rounding stays outside revenue and profit. A void
  is a reversal dated at the void.
- Permission `expenses.manage` for every expense route; alone it covers only the actor's own expenses,
  with `reports.view` the whole log (ruling of 2026-11-25). The profit and loss report and its CSV need
  `reports.view`, like every other margin figure (review of PR 7): `expenses.manage` alone records
  expenses and sees no profit; `reports.view` alone sees the report and not the log.

## Schema (migration `0024_expenses`)
`pos.expenses`: `tenant_id` FK → `pos.tenants`, RLS, `kind`, `category`, `amount`, `note`, `expense_date`
(a store-local `date`), `source`, `shift_id` + `drawer_cash_before` (drawer only), actor, `idempotency_key`
(unique per tenant) + `request_hash`, `updated_at`/`updated_by_*`, and the soft delete: `voided_at`,
`voided_by_*`, `void_reason`, `drawer_reversed`. Checks keep kind/category, source/shift and the void
columns consistent. The purge discovers the table by its `tenant_id`.

`pos.expense_edits` (migration `0025_expense_edits`, review of PR 7): the edit history. One append-only
row per `PATCH` that changed something: `changes` (jsonb, `{ field: { from, to } }` for each of
category, amount, note, date that changed), actor, time; composite FK to the expense, RLS, `tenant_id`.
A `PATCH` that changes nothing writes no row and leaves `updated_*` alone. `GET /expenses/:id` (and the
answer of create, update and void) carries `edits`, oldest first; list rows do not.

Shift ledger kinds (`CASH_ENTRY_KINDS`, text column, no migration): `expense` (out, `ref_id` = the expense)
and `expense_reversal` (in, `ref_id` = the expense). Both expense kinds use them. UMK-1970 (a supplier
payment tied to a purchase order, paid from a drawer) is not built: it can write `pos.expenses` rows of
kind `supplier_payment` through the same service, or add its own ledger kind; nothing here blocks either.

## Routes (`expenses.manage`; the report `reports.view`; tenant from the session)
- `POST /expenses` + `Idempotency-Key` → 201 the expense. Same key and body → the first expense, nothing
  written; same key, other body → 422.
- `GET /expenses?period=today|week|month` or `?from&to` (+ `status=active|voided|all`, paging): rows newest
  first and a `summary` over the whole range (active rows only): `expenses` (P&L expenses),
  `supplierPayments`, `fromDrawer`, `outside`, `byCategory`.
- `GET /expenses/csv` (same filter), `GET /expenses/categories`, `GET /expenses/:id`.
- `PATCH /expenses/:id`: category and note always; amount and date only of an `outside` expense (a drawer
  expense's cash already moved: void it and record it again). A voided expense is not edited (409).
- `POST /expenses/:id/void` `{ reason? }`: the soft delete. Repeating it changes nothing.
- `GET /reports/profit-loss?period=…|from&to` and `/csv` (`reports.view`). The response carries
  `taxIncluded: false` and `labels`; revenue, gross and net profit are labelled "(tanpa pajak)" on screen
  and in the CSV (ruling of 2026-11-25; before: `true`, "(termasuk pajak)").

## Decisions (documented, tested)
- **Void of a drawer expense.** The expense row is locked, then its shift. Shift still open → one
  `expense_reversal` cash-in entry in THAT shift (whoever voids), so its expected cash is back where it was:
  `drawerReversed: true`. Shift already closed → that shift was counted with the expense in it and never
  changes, and no drawer receives money: `drawerReversed: false`; the cash goes into the store cash, one
  `expense_void` entry by whoever voids (ruling of 2026-11-25; before: nothing was written). The expense
  leaves the totals and the profit and loss report either way.
- **A voided expense is removed, not reversed by date.** An expense's day is the date the user chose, so a
  past period can already change by backdating; a void takes the row out of every total of its date.
- **Gross profit in this report = revenue − cost**, as the approved design shows ("Hasil jualan − Modal
  barang terjual = Untung kotor"), with revenue WITHOUT tax (ruling of 2026-11-25): the same number as the
  other reports' `grossProfit` (their revenue − tax − cost). The response carries `tax` as its own line.
- **Previous period.** `period` mode compares like the dashboard: sales up to the same moment one period
  earlier (yesterday / 7 days / 1 month back), expenses through the same date. `from`/`to` mode compares
  whole days with the span of the same length just before `from`.
- **Week** = Monday to today; **month** = the 1st to today (store timezone).
- Lock order: expense row, then shift (void); create takes only the shift lock (through
  `recordShiftCash`), then inserts.

## Definition of Done
- [test] `POST /expenses` outside: 201, row with kind, category label, date default today (store timezone),
  no shift, no ledger entry; expected cash of an open shift unchanged.
- [test] Drawer expense: one `expense` ledger entry, the shift's expected cash and `cashOut`/`expenses` drop
  once, live, at close and in `GET /reports/shifts`; `exceedsDrawerCash` flags an amount above the drawer
  and still saves; without an open shift 422 and nothing is written; a date other than today 422.
- [test] Replay: same key and body → the first expense, one row, one ledger entry; other body → 422.
- [test] Validation (422, Indonesian, never 500): amount 0 / negative / float / string, unknown category,
  unknown source, unknown key, future date, impossible date, missing or bad `Idempotency-Key`, bad period,
  `period` with `from`, `from` without `to`.
- [test] Supplier payment: listed, lowers the drawer when paid from it, in `supplierPayments`, not in
  `expenses` of the list summary nor of the profit and loss report.
- [test] List: period filters, `from`/`to`, paging, totals by category, voided rows hidden by default.
- [test] Update: rules above; void: soft delete with who/when/reason, repeat is a no-op, open shift gets one
  reversal, a closed shift is unchanged (row, stored expected cash, ledger).
- [test] Permission: without `expenses.manage` every expense route answers 403; the report needs
  `reports.view`: a holder of `expenses.manage` alone records, edits and voids expenses and gets 403 on
  the report and its CSV; a holder of `reports.view` alone reads the report and gets 403 on the log.
- [test] Edit history: before and after per edit, who and when; no row for an edit that changes nothing
  or is refused.
- [test] Labels: `labels` in the JSON and the CSV lines name the tax-inclusive basis.
- [test] Deterministic races (the test holds the row lock from a second connection and releases it when
  the requests are queued): a drawer double tap is one expense and one cash-out; two voids are one
  reversal; a void before the close is counted in it, after the close leaves it as counted; a drawer
  expense after the close is refused.
- [test] Store day: default date, "not in the future" and the drawer's "today" follow the store's
  timezone (UTC+14 against UTC−12); a sale at 23:30 WIB / 00:30 WITA counts on different days in a WIB
  and a WITA store; 23:59:59 and 00:00:00 fall on either side.
- [test] Cross-tenant: store B gets 404 on read, update and void of store A's expense; B's list and report
  show nothing of A.
- [test] Profit and loss, fixture checked by hand: tax, cash rounding (outside revenue), a void (reversal),
  a kasbon sale (revenue), expenses, a supplier payment (excluded), a voided expense (excluded); previous
  period with backdated sales and expenses; top categories; CSV.
- [test] Guards: RLS and `tenant_id` (`db.e2e-spec`, `purge.e2e-spec` seed reaches `pos.expenses`); only
  `expenses/expenses.service.ts` writes the `expense` / `expense_reversal` ledger kinds and the
  `pos.expenses` table; the shift ledger is still inserted only in `shifts/cash-ledger.ts`.
- [test] Revert-red, once each: without the ledger write; with supplier payments counted in the report;
  with the ledger kind written from another file; without the tenant filter on read; with the report
  gated by `expenses.manage`; without the history insert; with a no-change edit recorded; with a void
  that is not idempotent; with the server's day instead of the store's; with a label changed.
- [test] An agent (MCP) session records only `outside` expenses and its rows are marked "via agent":
  **not built**. No agent session kind exists (`ACTOR_KINDS` is owner/cashier); it comes with UMK-1981 and
  must refuse `source = drawer` for that kind in `ExpensesService.create`.
- [cmd] `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=pos_u1984 npx jest --runInBand`.
- [qa] Expense list, form and profit and loss screens (loading, empty, error; Indonesian): not in this
  change.

## Files
- `apps/pos-api/src/db/schema/expenses.ts`, `db/schema/index.ts` (one line), `db/schema/shift-cash.ts`
  (two kinds), `drizzle/0024_expenses.sql`, `drizzle/0025_expense_edits.sql`.
- `apps/pos-api/src/expenses/`: `expenses.schemas.ts`, `expenses.service.ts`, `profit-loss.service.ts`,
  `expenses.controller.ts` (controllers and module); `app.module.ts` (one line).
- `apps/pos-api/src/shifts/cash-ledger.ts` (`recordShiftCashInShift`, totals `expenses` /
  `expenseReversals`), `shifts.service.ts` (`expectedCashOf`), `shifts.module.ts` (export).
- `apps/pos-api/src/reports/reports.service.ts` (`salesTotals` hook, shift rows gain `expenses`,
  `expenseReversals`), `reports.controller.ts` (export the service).
- `apps/pos-api/src/guards.spec.ts`.

## Tests
`apps/pos-api/test/expenses.e2e-spec.ts` (new), `test/purge.e2e-spec.ts` (seed), `src/guards.spec.ts`.

## Follow-ups (not built)
- UMK-1970: supplier payment tied to a purchase order, paid from the drawer.
- UMK-1981: agent write tool "record an expense" (outside only), the "via agent" mark.
- Expenses paid from the store cash ("kas toko", UMK-1963 follow-up): a third source.
- Shift close screen line "Pengeluaran dari laci" = `expenses − expenseReversals` (UI).

## Owner questions: answered 2026-11-25 (built in plan `2026-11-25-003`)
1. Gross profit and tax: gross profit excludes tax everywhere; this report follows the dashboard.
2. Void of a drawer expense whose shift is closed: the cash goes into the store cash; the closed shift
   keeps its count.
3. Own-rows scope: `expenses.manage` alone covers the actor's own expenses; `reports.view` the whole log.
