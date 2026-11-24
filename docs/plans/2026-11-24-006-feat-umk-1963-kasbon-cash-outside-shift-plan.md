# UMK-1963 follow-up: cash kasbon instalments without an open shift (server part)

Epic UMK-1924, unit U7. Follows `2026-11-24-002` (shift cash ledger). Owner ruling of 24 Nov 2026: staff
who hold only `receivables.manage` (they cannot open a shift, which needs `sales.create`) may accept a
cash kasbon instalment without an open shift. Kasbon cash instalments stay unrounded.

## Goal
`POST /receivables/:id/payments` with a cash method no longer needs an open shift.
- The actor has an open shift: unchanged. The payment gets a `receivable_payment` ledger entry in that
  shift and raises its expected cash.
- The actor has no open shift: the payment is accepted and recorded as collected outside any shift. It
  writes no ledger entry, so it is in no shift's expected cash, now or later.

## Schema (migration 0020)
One column: `pos.receivable_payments.collected_outside_shift boolean not null default false`.
- It is the explicit marker. It is `true` only for a cash instalment taken while its collector had no
  open shift. Existing rows stay `false` (before this change such a payment was refused).
- The shift link is not stored twice: a payment taken in a shift is linked by its ledger entry
  (`pos.shift_cash_entries.kind = 'receivable_payment'`, `ref_id` = the payment). A payment has a ledger
  entry or the marker, never both; a kasbon down payment and a non-cash payment have neither.
- Who collected it and when are the row's existing `actor_id`, `actor_kind` and `created_at`.
  Payment rows are append-only, so the audit never changes.

## Behaviour
- The choice is made once, in the payment's transaction, under the receivable row lock and then the
  actor's open-shift row lock (`recordShiftCashIfOpen` in `src/shifts/cash-ledger.ts`, still the only
  writer of the ledger): either the ledger entry is inserted, or the marker is set.
- Race with `POST /shifts/open`: the payment either sees the committed shift (ledger entry) or does not
  (marker). Both outcomes are consistent; the payment is never in two places or in none. Race with the
  close: the close holds the shift's row lock, so the payment is counted in the close, or lands after it
  as an outside-shift collection (before this change: refused).
- An `Idempotency-Key` replay returns the first result and writes nothing, also after a shift was opened
  later: an outside-shift payment never moves into a shift.
- Non-cash methods: unchanged (no shift, no ledger entry, marker `false`).
- Amounts are not rounded (a kasbon instalment is whatever the member hands over, up to the rest).
- Tenant isolation: unchanged (`tenantId` from the session on every query).

## Void of a kasbon sale with an outside-shift instalment (decision)
The existing rule stays, with no special case: every cash instalment of the voided sale is given back in
cash out of the drawer of the shift the voiding actor has open NOW, as one `void_refund` ledger entry;
without an open shift the void answers 422 "Buka shift dulu untuk membatalkan struk tunai" and changes
nothing. This already ignores where the cash came in (an instalment taken in another, closed shift is
returned from the current drawer too), so an outside-shift instalment is the same case: the cash to give
back has to come from a drawer someone is accountable for, and a void needs `sales.create` and so an actor
who can open a shift. Consequence to know: that shift's expected cash drops by an amount it never
received; the void's return row carries `collectedOutsideShift: true` so the shift report's reader can
see why. The payment row itself is never changed by the void.

## Reporting (no new screen)
- `GET /receivables/:id` payment rows gain `collectedOutsideShift`, `shiftId` (the shift whose ledger has
  the payment, else null), `actorId` and `actorName` (next to the existing `actorKind`, `createdAt`).
- Receivable rows (`GET /receivables`, `GET /receivables/:id`) gain `outsideShiftCollected`, the sum of
  that receivable's outside-shift collections; the list `summary` gains `outsideShiftCollected` over the
  search (any status, like `openRest`).
- `GET /sales/:id/void` return rows gain `collectedOutsideShift`.
- Shift responses and `/reports/shifts` do not change: they are per shift and these payments are in none.

## Definition of Done
- [test] A cash payment without an open shift answers 201, lowers the rest, is marked
  `collectedOutsideShift` with its collector and time, and writes no ledger entry.
- [test] A shift opened afterwards (by the same actor) starts at its opening cash and stays there, live
  and at close; no earlier shift changes.
- [test] A cash payment with an open shift is unchanged: ledger entry, expected cash up, marker `false`.
- [test] A replayed key returns the first result and writes nothing, also after a shift was opened later.
- [test] A payment racing `/shifts/open` and one racing the close land in exactly one place.
- [test] A cashier with only `receivables.manage` (403 on `/shifts/open`) takes a cash instalment.
- [test] Receivable rows and the list summary show `outsideShiftCollected`; a non-cash payment is not in it.
- [test] Void of a kasbon sale with an outside-shift instalment: 422 without an open shift (nothing
  changes), with one the cash leaves that drawer and the return row says `collectedOutsideShift`.
- [test] Cross-tenant: store B gets 404 paying store A's receivable without a shift; A is unchanged and
  B's figures show nothing of A.
- [test] Revert-red, once: with the marker forced to `false` and with the old refusal restored, the new
  tests fail.
- [cmd] `npm run lint && npm run typecheck && npm run build`, `PGTEST_DB=pos_u1963b npx jest --runInBand`.
- [qa] Receivable screen shows the outside-shift label and amount: not done here (server only).

## Files
- `apps/pos-api/src/db/schema/receivables.ts`, `drizzle/0020_*.sql` (generated).
- `apps/pos-api/src/shifts/cash-ledger.ts` (`recordShiftCashIfOpen`).
- `apps/pos-api/src/receivables/receivables.controller.ts` (`pay`, `get`, `list`).
- `apps/pos-api/src/void/void.service.ts` (return rows show the marker; `cancelReceivable` unchanged).

## Tests to add
`apps/pos-api/test/shift-cash.e2e-spec.ts` (new block, and the three tests that expected the 422),
`test/void.e2e-spec.ts` (outside-shift instalment), `test/members.e2e-spec.ts` (the cashier test goes back
to a `receivables.manage`-only cashier without a shift).
