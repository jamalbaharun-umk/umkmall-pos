# UMK-1963: shift cash ledger, receivable payments in expected cash (server part)

Epic UMK-1924, unit U7 ("Not done: receivable payments in a shift's cash count"). Owner decisions of
24 Nov 2026 on UMK-1963: the drawer ledger stays in pos-api; one ledger of cash in and cash out per shift;
a cash receivable payment needs an open shift, like a sale.

## Goal
A shift's cash is one append-only ledger, `pos.shift_cash_entries` (direction `in`/`out`, a `kind`, an
amount, the source row in `ref_id`). Expected cash = opening cash + cash sales + cash in − cash out.
Cash sales and kasbon down payments keep coming from the shift's sales; everything else that moves drawer
cash is a ledger entry. This change writes the first kind, `receivable_payment`. Supplier payments from the
drawer (UMK-1970), expenses (UMK-1984) and void cash out (UMK-1962) add a kind and call the same function;
they need no schema change.

The screens wait for an owner-approved design (label "Needs design"): no pos-web change here.

## Behaviour
- `POST /receivables/:id/payments` with a cash method: the actor must have an open shift (422
  "Buka shift dulu sebelum menerima pembayaran tunai" otherwise). The payment, the receivable balance and
  the ledger entry are written in one transaction, under the receivable row lock and then the shift row
  lock (the lock a sale and the close take), so a payment lands before the count or is refused.
- A non-cash method (debit, wallet) needs no shift and writes no ledger entry.
- An `Idempotency-Key` replay returns the first result and writes nothing, also after the shift closed.
- Entries are written only by `recordShiftCash` (`src/shifts/cash-ledger.ts`), which locks the actor's OPEN
  shift first: a closed shift never gets an entry, and nothing updates or deletes entries.
- Shift responses (`/shifts/current`, `/shifts/current/close`, `/shifts`, `/shifts/:id`) gain `cashIn`,
  `cashOut`, `receivablePayments`; `/shifts/:id` also lists `cashEntries`. `/reports/shifts` rows and its
  CSV gain the same three amounts.

## Definition of Done
- [test] A cash receivable payment taken while a shift is open is linked to that shift (a ledger entry
  with the payment's id) and raises its expected cash, live and at close.
- [test] A non-cash payment method does not change expected cash and needs no shift.
- [test] A cash payment without an open shift answers 422 and changes neither the receivable nor any shift.
- [test] Cash sales and kasbon down payments still count; a down payment is not counted twice.
- [test] A closed shift is never changed: a later payment goes to the actor's next shift.
- [test] A replayed `Idempotency-Key` writes one entry; a payment racing the close is counted or refused.
- [test] Shift close, shift list/detail and the shift report (JSON and CSV) expose the receivable payments
  line and the cash in/out totals.
- [test] Cross-tenant: store B gets 404 on store A's shift and receivable (read and pay), and A's ledger
  is unchanged; a cashier without `reports.view` gets 404 on another actor's shift.
- [test] Guards: the table has RLS and `tenant_id` (`db.e2e-spec`, `purge.e2e-spec`); entries are inserted
  only in `src/shifts/cash-ledger.ts` (`src/guards.spec.ts`, proven once by revert-red).
- [cmd] `npm run lint && npm run typecheck && npm run build -w pos-api`, `PGTEST_DB=pos_u1963 npm test`.
- [qa] Shift close and shift report screens show the receivable payments line: not done here (UI waits
  for design approval).

## Files
- `apps/pos-api/src/db/schema/shift-cash.ts` (new table), `db/schema/index.ts` (one line),
  `drizzle/0017_*.sql` (generated).
- `apps/pos-api/src/shifts/cash-ledger.ts` (new: `lockOpenShift`, `recordShiftCash`, `cashTotals`),
  `shifts.service.ts`.
- `apps/pos-api/src/receivables/receivables.controller.ts` (`pay`).
- `apps/pos-api/src/reports/reports.service.ts`, `reports.controller.ts` (shift report rows, CSV columns).
- `apps/pos-api/src/guards.spec.ts`.

## Tests to add
`apps/pos-api/test/shift-cash.e2e-spec.ts` (every `[test]` line above); `test/members.e2e-spec.ts` and any
other spec that pays a receivable in cash without a shift now opens one first.
