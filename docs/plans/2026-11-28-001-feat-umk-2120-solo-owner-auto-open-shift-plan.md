# feat(shifts): solo-owner mode, the owner's first cash action opens the shift (UMK-2120)

Epic UMK-1924, issue UMK-2120. Server only, no new screen.

## Goal

A store run by its owner alone never answers "Buka shift dulu ..." / `SHIFT_REQUIRED` to the owner: the owner's
first cash action (a sale, a cash kasbon instalment, a drawer expense, a cash void, any other movement of drawer cash)
opens the owner's shift inside the action's own transaction, with the cash the drawer was left with. Every other store,
and every staff session, keeps today's behaviour. The "Tunai" method exists from store creation.

## Rules

1. **Solo** = the store has no staff member that is active and not deleted (`pos.staff.active` and
   `deleted_at is null`). One such member, of any role (also a collector without `sales.create`), means not solo.
   Read inside the action's transaction on every call, never cached: adding the first staff member ends auto-open at
   once, deleting or deactivating the last one starts it.
2. **Who:** only the owner, that is a session of kind `owner`, or `agent` (UMKMall's agent acting as the owner:
   same actor id, owner decision 2026-11-28, the mode is the owner's standing word). Never a `cashier` session, also
   in a store that looks solo.
3. **One helper** (`src/shifts/cash-ledger.ts`): `lockDrawerShift(tx, s)` = the actor's open shift row-locked
   (`lockOpenShift`), or, when there is none and the store is solo and the actor is the owner, `autoOpenShift`. Every
   path that takes the actor's drawer for a cash action goes through it:
   - sale creation (`SalesService.insert`, also a kasbon sale's cash down payment);
   - `recordShiftCashIfOpen` / `recordShiftCash`: cash kasbon instalment (`ReceivablesController` pay,
     `ReceivableCorrectionsService` corrected instalment), drawer expense, cash void/refund cash-out, purchase
     payments and refunds from or into the drawer;
   - `lockShiftForCash` / `recordShiftCashAt` without a named shift: manual cash in/out, collector deposits (never
     solo in practice: a collector is a staff member).
   Not through it, so never opening a shift: closing a shift, a void whose money goes back by transfer only (needs no
   drawer), a correction of an entry of a named shift (`recordShiftCashInShift`), every read.
4. **Locks and concurrency.** The helper runs inside the caller's transaction at the point where the caller already
   locks the open shift, so the code base's lock order is unchanged (sale → receivable → open shift → voucher → stock
   batches). The new shift is written with `insert … on conflict do nothing` on the existing partial unique index
   `shifts_one_open_uq (tenant_id, actor_id) where closed_at is null`, then selected `for update`. Two first actions
   at once: the second insert waits on the first's uncommitted row, does nothing once it commits, and its select
   (a new statement under READ COMMITTED) finds and locks the committed shift. If the first rolls back, the second
   inserts the row itself. Exactly one shift, both actions in it. No migration, no advisory lock.
5. **Opening cash** = `counted_cash` of the store's most recently closed shift (any actor: the drawer's last count),
   0 when the store never closed a shift. What the owner took "at that close" is recorded as a manual cash-out with
   the reason `ambil_pemilik` ("Diambil pemilik"), which can only be written while the shift is still open (a closed
   shift takes no entry), so it is always out of the drawer before the count: the counted cash already excludes it,
   and subtracting it again would count it twice. Never negative: `counted_cash >= 0` is a database check.
   Example: opening 100.000, cash sales 250.000, "Diambil pemilik" 200.000 recorded before closing; expected
   150.000; the owner counts 150.000 and closes. The next automatic opening is 150.000 (not 150.000 − 200.000, which
   would be negative and floor at 0). Had the owner counted 148.000 (2.000 short), the opening is 148.000: the drawer
   holds what was counted.
6. **Recorded like a normal open:** same `pos.shifts` columns (actor, `actor_kind` = the session's kind, opening
   cash), plus a `shift_open` audit row in the same transaction with `details.automatic = true` and
   `details.trigger` (`sale`, `receivable_payment`, `expense`, `void_refund`, ... the ledger kind of the action). No new
   column: the audit log carries the marker.
7. **Errors unchanged** for a store with staff and for staff sessions: the same 422 `SHIFT_REQUIRED` (or the same
   field error of the sale) with the same message.
8. **The agent:** `record_sale` asks `GET /shifts/current` first and refused without a shift. That answer now carries
   `autoOpen` (true when no shift is open and this actor's next cash action would open one), and the tool goes on when
   it is true; the sale itself goes through `POST /sales` like the till, with `actor_kind = 'agent'` on the sale. Cash
   kasbon instalments through the agent need no change (the route decides). This is the one change in `src/agent`.
9. **Tunai from store creation:** `findOrCreateTenant` (every sign-in: owner, refresh, dev, agent) creates the store
   and its "Tunai" in one transaction, idempotently (`cashMethodId`, insert on conflict do nothing), so the
   "Kelengkapan toko" step `methods` is done at once. An existing store without Tunai gets it at its owner's next
   sign-in; the lazy paths (`cashMethodId` at a sale, the payment-method list) stay. No data migration.

## Definition of Done

- [test] Solo store, owner, no open shift: the first sale opens a shift and lands in it; opening cash = the last
  closed shift's counted cash (with and without a "Diambil pemilik" before that close; no previous shift → 0).
- [test] The audit log has one `shift_open` row with `automatic: true` for it; an action that fails afterwards
  (rolled back) leaves no shift and no audit row.
- [test] A store with one active staff member: the owner and the cashier both still get 422 `SHIFT_REQUIRED` /
  "Buka shift dulu sebelum berjualan"; a cashier is refused also when the owner's side would be solo-like.
- [test] Deleted or inactive staff do not count; adding a staff member ends auto-open.
- [test] Two concurrent first sales (`Promise.all`) open one shift, both sales in it.
- [test] Cross-tenant: store B's first sale opens B's own shift; A's shift is untouched and its opening cash is not
  taken from A's close.
- [test] Cash expense, cash kasbon instalment, cash void each auto-open for a solo owner.
- [test] Agent `record_sale` for a solo owner with no open shift opens one (actor = owner, `actor_kind = 'agent'`).
- [test] Tunai exists right after the first sign-in; `GET /summaries/setup` ticks `methods`.
- [test] Revert-red once: the staff-count guard disabled (every store solo) fails the "one staff member" test.
- [cmd] `npx tsc --noEmit`, eslint on touched files, the touched and related e2e specs, then the full pos-api suite.

## Files

- `apps/pos-api/src/shifts/cash-ledger.ts`: `isSoloOwner`, `autoOpenShift`, `lockDrawerShift`; the writers use it.
- `apps/pos-api/src/shifts/shifts.service.ts`: `current` answers `autoOpen`.
- `apps/pos-api/src/sales/sales.service.ts`: the sale's shift through `lockDrawerShift`.
- `apps/pos-api/src/auth/auth.controller.ts`: Tunai with the store.
- `apps/pos-api/src/agent/tools.ts`: `record_sale` goes on when `autoOpen`.
- `apps/pos-api/test/solo-shift.e2e-spec.ts` (new); existing specs that assert the no-shift refusal for an owner of a
  store without staff get one staff member, so they still prove today's refusal.
- `apps/pos-api/README.md`: the shift rule.

## Not in scope

A screen (the close screen could later offer "Diambil pemilik" next to the count). A close-time "owner took" figure
recorded after the count: today there is none, so rule 5 has nothing to subtract after the count.
