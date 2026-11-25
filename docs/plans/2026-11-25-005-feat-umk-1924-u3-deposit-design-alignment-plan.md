# UMK-1924 U3 / UMK-1963: kas laci and setoran penagih, server aligned with the approved design

Epic UMK-1924, unit U3. Follows `2026-11-25-003-…-u3-cash-entries-deposits-plan.md` (PR 14: manual drawer
cash, store cash handover), which was written before a design existed. The owner has since approved
`Desain Fitur Lanjutan POS`, fitur **20 (Uang masuk dan keluar laci)** and **21 (Setoran penagih ke kas
toko)**, HP and desktop, and ruled (2026-11-25):

> A kasbon cash instalment taken by a collector (no open shift) lowers the customer's debt at once, but the
> cash is "dipegang penagih" until the deposit is received; when it is received the cash enters the
> receiver's open shift drawer and shows in the drawer list as "Setoran penagih".

Server only. The screens come in a follow-up change; every response addition is backward compatible.

## What the design fixes (read in full, both tabs, both views)
- Fitur 21: "Yang menerima, kasir atau pemilik, mencatat setoran; hasilnya **masuk laci shift yang buka**";
  summary "Diserahkan oleh Dedi (penagih) / Diterima oleh Rina (Anda) / Masuk ke Laci shift Rina (#13)";
  "Hanya saat ada shift buka; uang masuk laci shift itu"; error "Shift belum dibuka, jadi uang tidak bisa
  masuk laci", `Kode: SHIFT_REQUIRED`. History "Dedi menyerahkan ke Rina · 25 Nov, 11.05 · shift #13";
  "Muncul juga di layar tutup shift sebagai '+ Setoran penagih'". Collector's screen "Setoran saya", read
  only. "Penerima adalah pengguna yang masuk, tidak bisa dipilih, dan tidak boleh sama dengan penyerah."
  "Asisten otomatis (agent) tidak bisa mencatat setoran."
- Fitur 20: drawer list "Shift Rina · dibuka 07.00"; rows "Tambah modal laci · dicatat Rina · 09.30" and
  "Setoran penagih · Dedi · diterima Rina · 11.05"; error `Kode: DRAWER_INSUFFICIENT` with the drawer's
  current cash ("Batas jumlah sudah diperbarui"); "riwayat menandai Dibatalkan dan Pembalik dari catatan
  asal"; "Asisten otomatis (agent) tidak bisa mencatat uang keluar, **uang masuk**, atau mengoreksi";
  "Pemilik yang mencatat tetap memakai shift yang sedang buka; bila dua shift buka, pengguna memilih shift
  lebih dulu."

## Goal
1. A received deposit puts the cash into an open shift drawer (the receiver's), raises that shift's expected
   cash, and is listed in the shift as "Setoran penagih"; the cash is never counted twice.
2. The reads the two screens need exist under the permissions their users hold: recorder names, reversal
   markers, the receiver's form data under `store_cash.manage`, the collector's own "Setoran saya".
3. Every refusal of a cash entry or a deposit carries a stable machine-readable `code`.

## The accounting (decided here)
"Kas toko" (`pos.store_cash_entries`) is the cash the store holds **outside every shift drawer**; its
balance is Σ in − Σ out. A collector's outside-shift instalment is an `in` there (unchanged, plan
`2026-11-24-006`): that is the "dipegang penagih" money.

A deposit now writes, in one transaction:
- shift ledger: `in`, kind `collector_deposit`, `ref_id` = the deposit, in the receiving shift, through
  `cash-ledger.ts` under that shift's row lock (expected cash rises);
- store ledger: **`out`**, kind `collector_deposit`, `ref_id` = the deposit (the cash left "outside every
  drawer"), through `recordStoreCash`;
- `pos.store_cash_deposits`: the audit row, now with `shift_id`.

So a rupiah is at any time in exactly one place: with a collector (store ledger balance) or in a drawer
(shift ledger). Store balance + Σ drawers is unchanged by a deposit. Before this change the deposit was a
store ledger `transfer` (balance unchanged, "the safe"); with the cash now in a drawer, leaving the balance
unchanged would count it twice.

- `GET /store-cash` `summary`: `cashOut` rises and `balance` falls by each deposit; `outstanding` (Σ per
  collector) and `handedOver` (Σ deposits) as before. `balance` = `outstanding` + cash returned to the store
  for expenses voided after their shift closed (`expense_void`) + legacy handovers.
- Legacy rows: a deposit written by PR 14 (store ledger `transfer`, `shift_id` null) stays as it is: that
  cash went to a safe, is still in the balance, and is in no drawer. The direction `transfer` stays valid
  in the check constraint; nothing writes it any more.
- A collector's outstanding = Σ their outside-shift collections − Σ deposits in their name (unchanged), under
  the collector's staff row lock.
- Lock order of a deposit: collector's staff row, then the shift row. Nothing locks a shift and then a staff
  row.

## Endpoints and shapes
Refusal shape (unchanged fields, one added): `{ message, errors: { <field>: message }, code }`; a 403 keeps
`{ message, error: 'Forbidden', statusCode: 403 }` and gains `code`. Codes:

| code | status | when | extra field |
|---|---|---|---|
| `SHIFT_REQUIRED` | 422 | no open shift to put the cash in (cash entry, deposit; also drawer expense and cash void, which use the same ledger function) | |
| `SHIFT_NOT_YOURS` | 422 | `shiftId` names a shift a cashier may not use, or one that is closed / not this store's | |
| `DRAWER_INSUFFICIENT` | 422 | manual cash-out above the drawer | `drawerCash` (integer rupiah, the drawer now) |
| `DEPOSIT_EXCEEDS_OUTSTANDING` | 422 | deposit above the collector's outstanding | `outstanding` |
| `NOTHING_OUTSTANDING` | 422 | the collector holds nothing | `outstanding: 0` |
| `SELF_DEPOSIT` | 422 | receiver = collector | |
| `IDEMPOTENCY_KEY_REUSED` | 422 | the key with another body | |
| `AGENT_FORBIDDEN` | 403 | a session kind that is not a person at the till | |

Input validation by zod (422) and a missing permission (403) answer as before, without a `code`.

### `POST /store-cash/deposits` (`store_cash.manage`, `Idempotency-Key`)
Body (strict): `{ collectorId, amount, note?, shiftId? }`.
- The cash goes into the **actor's own open shift**. No open shift: 422 `SHIFT_REQUIRED`, nothing written,
  the key not claimed.
- `shiftId` (optional) is the design's "bila dua shift buka, pengguna memilih shift": an **owner** session
  may name any open shift of the store (an owner without a shift of their own receives into a cashier's
  drawer). A cashier's cash always goes into their own shift: a `shiftId` that is not their open shift is
  422 `SHIFT_NOT_YOURS`. The id is looked up with the session's tenant; another store's id is
  `SHIFT_NOT_YOURS` too.
- Refused for a session kind off the till allow-list (`AGENT_FORBIDDEN`), before any query.
- Other rules as before (receiver ≠ collector, ≤ outstanding, 404 for an unknown staff id, replay).
- Response, added fields: `shiftId`, `shiftNumber`, `shiftActorName` (whose drawer; all three null on a
  legacy deposit).

### `GET /store-cash/deposits` — now `store_cash.manage` **or** `reports.view`
The design's "Riwayat untuk pemilik dan kasir". Rows as the POST answer.

### `GET /store-cash/collectors` (`store_cash.manage`, unchanged) — rows gain `active`
`active`: the staff member is neither removed nor switched off (always true for an owner row). The form's
"Diserahkan oleh" lists the active ones with `outstanding > 0`.

### `GET /store-cash/mine?page&perPage` — any signed-in session (new)
The design's "Setoran saya". Only the actor's own figures and rows:
`{ collectorId, collected, handedOver, outstanding, data: Deposit[], total, page, perPage }`, deposits
newest first, each `{ id, amount, note, receivedByKind, receivedByName, shiftId, shiftNumber, createdAt }`
(no other staff member's id, no other collector's row). An actor who never collected gets zeros and `[]`.

### `POST /shifts/current/cash-entries` (`sales.create`, unchanged path)
- Body gains optional `shiftId` with the same rule as the deposit (owner only).
- Refused for a session kind off the till allow-list in **both** directions (design: an agent records
  neither cash out nor cash in); the ledger-level rule (cash out) stays as it is for every other writer.
- Refusals gain `code`; `DRAWER_INSUFFICIENT` carries `drawerCash`.

### Shift reads
- `GET /shifts/current`, `GET /shifts`, `GET /shifts/:id`, `POST /shifts/open`, `POST /shifts/current/close`:
  each shift gains `number` (the store's n-th shift by opening time; derived on read with one query per
  page, no column) and
  `actorName` ("Pemilik" for an owner, the staff name for a cashier), and the totals gain
  `collectorDeposits` (part of `cashIn`). `/reports/shifts` rows gain `collectorDeposits` (CSV unchanged).
- `GET /shifts/:id` `cashEntries` rows gain:
  - `actorId`, `actorKind`, `actorName`: who recorded the entry;
  - `collectorId`, `collectorName`: for a `collector_deposit` entry, who handed over (null otherwise);
  - `reversed` (boolean): the entry's source was undone — an `expense` whose expense is voided, a
    `receivable_payment` whose receivable was cancelled by a void of its sale;
  - `reversalOf` (`{ type: 'expense' | 'sale', id, entryId } | null`): this entry undoes something — an
    `expense_reversal` (`entryId` = the `expense` entry it puts back), a `void_refund` (`type: 'sale'`,
    `id` = the sale, `entryId: null`: a sale's cash is not a ledger row).
  Both are derived on read from rows the server already writes; no schema change. A manual entry and a
  deposit cannot be reversed yet (see Not built), so theirs are `false` / `null`.
  A cashier still sees only their own shifts here (404 otherwise); names are the only staff data added.

## Schema (one generated migration, `0032_deposit_shift`)
- `pos.store_cash_deposits.shift_id uuid` nullable (null = a legacy handover to the safe), FK
  `(tenant_id, shift_id)` → `pos.shifts`, `ON DELETE restrict`. The purge orders by foreign key, so it
  deletes deposits before shifts.
- Ledger kind `collector_deposit` of the shift ledger is a text value: no column change.

## Existing tests whose expectations change, and why
- `test/store-cash-deposits.e2e-spec.ts`: the receiver now opens a shift first (a deposit needs a drawer);
  the store ledger line is `out` (was `transfer`) and `summary.cashOut` / `balance` move by the deposit
  (the cash left "outside every drawer"); the "nobody may deposit" receivers that had no shift now get
  `SHIFT_REQUIRED` only after their permission passes; rows carry the new fields.
- `test/purge.e2e-spec.ts` seed: unchanged in behaviour (the owner's shift is already open when the seed
  deposits); its row now also exercises the `shift_id` foreign key in the purge's delete order.
- `test/cash-entries.e2e-spec.ts`: the exact-shape assertion on `cashEntries` rows gains the actor,
  collector and marker fields; the no-shift, overdraw and reused-key refusals are asserted with their
  `code`. Every other suite asserts shifts with `toMatchObject` and needed no change.
- `src/guards.spec.ts`: the shift ledger kind `collector_deposit` is written only by the deposits service;
  the ledger has three writers that insert.
- `src/shifts/cash-ledger.spec.ts`: the till allow-list also guards hand-recorded cash in and deposits.

## Definition of Done
- [test] Deposit with the receiver's shift open: 201; shift `expectedCash`, `cashIn`, `collectorDeposits`
  rise live and at close; `GET /shifts/:id` lists a `collector_deposit` entry with collector and receiver
  names; the deposit names `shiftId`, `shiftNumber`, `shiftActorName`.
- [test] No double counting: store `balance` falls and the drawer rises by the same amount; store balance +
  drawer cash is the same before and after; `outstanding` falls; the store ledger has one `out` row and no
  `transfer`.
- [test] No open shift: 422 `SHIFT_REQUIRED`, nothing written in either ledger, the key not claimed (the
  same key works after opening a shift). A closed shift is not a drawer.
- [test] `shiftId`: an owner without an own shift deposits into a cashier's open shift; a cashier naming
  another's shift, a closed shift, another store's shift: 422 `SHIFT_NOT_YOURS`, nothing written.
- [test] Above the outstanding: 422 `DEPOSIT_EXCEEDS_OUTSTANDING` with `outstanding`; nothing outstanding:
  `NOTHING_OUTSTANDING`; self: `SELF_DEPOSIT`; key with another body: `IDEMPOTENCY_KEY_REUSED`.
- [test] Two concurrent deposits that together exceed the outstanding: one 201, one 422 (staff row lock
  held by the test); one drawer entry.
- [test] Idempotent: a replay returns the first deposit, one row in each ledger, also after the shift
  closed; two concurrent requests with one key write one deposit.
- [test] Permissions: `POST` 403 without `store_cash.manage`; `GET /store-cash/deposits` 200 with
  `store_cash.manage` alone and with `reports.view` alone, 403 with neither; `GET /store-cash/collectors`
  with `store_cash.manage` alone.
- [test] `GET /store-cash/mine`: a collector sees their own figures and deposits only (a second collector's
  rows are absent), with no extra permission; an owner sees zeros; 401 without a session.
- [test] Cross-tenant: store B gets 404 depositing for A's collector, `SHIFT_NOT_YOURS` naming A's shift,
  sees nothing of A in `/deposits`, `/collectors`, `/mine`; A's figures unchanged.
- [test] Cash entries: `code` on no shift, on overdraw (with `drawerCash`), on a reused key; an owner
  records into a cashier's open shift with `shiftId`; a cashier cannot.
- [test] `GET /shifts/:id` `cashEntries`: `actorName` / `actorKind` per entry; an expense voided while its
  shift is open shows `reversed` on the `expense` entry and `reversalOf` on the `expense_reversal`; a cash
  void shows `reversalOf: { type: 'sale' }`; a cancelled kasbon's instalment shows `reversed`.
- [test] Agent: a session kind off the allow-list is refused 403 `AGENT_FORBIDDEN` for a manual cash-in, a
  manual cash-out and a deposit before the database is reached (unit tests; no agent session kind exists
  yet, UMK-1983); the ledger still refuses its cash-out.
- [test] Guards: `collector_deposit` (both ledgers) and `pos.store_cash_deposits` written only in
  `store-cash/store-cash-deposits.service.ts`, through `recordStoreCash` and the shift ledger; RLS and
  `tenant_id` (`db.e2e-spec`, `purge.e2e-spec`).
- [test] Revert-red, once each: the shift requirement of the deposit; the store ledger `out` (back to
  `transfer` → the no-double-counting test and the guard fail); the owner-only rule of `shiftId`; the
  tenant filter of the `shiftId` lookup; the own-rows filter of `/mine` (rows, and figures); the till
  allow-list call in the deposit and in the cash entry; the `code` of a refusal (`SHIFT_REQUIRED`,
  `DRAWER_INSUFFICIENT`, `DEPOSIT_EXCEEDS_OUTSTANDING`, `SELF_DEPOSIT`); a `collector_deposit` written
  outside the service (guard); the outstanding check and the staff row lock of the deposit; the `reversed`
  marker; the `collectorDeposits` total.
- [cmd] `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=pos_dep npx jest --runInBand` in
  `apps/pos-api`.
- [qa] The screens (Kas laci, Terima setoran, Setoran saya, Riwayat setoran, the "+ Setoran penagih" line
  on tutup shift): follow-up change.
- [manual] When the `agent` session kind exists (UMK-1983): e2e that an agent token gets 403 on both
  endpoints.

## Review follow-up (PR 21)
- A cash entry looks its `Idempotency-Key` up **before** the shift lock (and again under it): a retry that
  names a `shiftId` still answers the first entry after that shift closed, instead of `SHIFT_NOT_YOURS`.
- A key answers only the actor who first sent it (cash entries and deposits): another actor of the store
  sending the same key gets 422 `IDEMPOTENCY_KEY_REUSED`, never the first actor's row. The unique index
  stays per store, so the same key cannot hold two rows and nothing answers 500.
- A shift's `number` is read with one window query per page (`shiftNumbers`), not one count per row.
- [test] the three above; revert-red on the early key lookup and on the actor check of each service.

## Not built (the design names it; listed for the owner)
1. **Reversing a manual cash entry or a deposit** ("Salah catat: dibatalkan dengan catatan pembalik di shift
   yang sedang buka, hanya sekali per catatan"; "koreksi dengan catatan pembalik seperti kas laci"). No
   endpoint exists; the `reversed` / `reversalOf` fields are in place for it.
2. **"Laporkan tidak sesuai"** on Setoran saya (a report the owner checks). Needs its own table and an owner
   view the design does not draw.
3. **Role "Penagih"** as a seeded default role, and "Daftar Diserahkan oleh hanya berisi staf aktif berperan
   Penagih". Roles are per store and free-named; the server lists who actually holds outside-shift cash
   (with `active`). Seeding the role is a one-line change in `staff/permissions.ts` (another module).
4. **Permission `cash.manage`** ("Usulan untuk dicek": one key for cash in, cash out and receiving a
   deposit). Today: manual cash needs `sales.create`, receiving needs `store_cash.manage`. Renaming changes
   who may do what in stores that already assigned roles.

## Open questions for the owner
1. **A deposit above the collector's outstanding.** The design says "Jumlah di atas itu memunculkan
   peringatan" (a warning). The server **refuses** it (`DEPOSIT_EXCEEDS_OUTSTANDING`, with the outstanding
   to show): accepting it would put cash into a drawer that no kasbon payment explains and make the
   collector's outstanding negative. If the warning is meant to allow the deposit, say where the surplus is
   booked.
2. **Which drawer.** Built: the receiver's own open shift; an owner may pick another open shift
   (`shiftId`). An owner with no own shift and no `shiftId` is refused (`SHIFT_REQUIRED`) even when exactly
   one shift is open in the store: the screen is expected to send that shift's id. Is a cashier ever to
   receive into another cashier's drawer? Built: never.
3. **Shift number** ("shift #13") is derived on read as the store's n-th shift by opening time; there is no
   stored number. Fitur 9 shows the same number on kasbon payments. Should it become a stored column?
4. **Owner's name.** The design shows "Diterima Pak Budi"; the POS knows an owner only as "Pemilik" (it
   reads no UMKMall profile).
5. A void of a kasbon sale still pays the customer from a drawer and leaves the collector's outstanding as
   it was (plan `2026-11-24-006`): the collector still owes that cash.
6. Items 1 to 4 of "Not built".

## Files
- `apps/pos-api/src/db/schema/shift-cash.ts` (kind), `db/schema/store-cash.ts` (`shift_id`, comments),
  `drizzle/0032_deposit_shift.sql` (generated).
- `apps/pos-api/src/common/validation.ts` (`codedError`: a `fieldError` with a `code`).
- `apps/pos-api/src/shifts/cash-ledger.ts` (till allow-list for hand-recorded cash, the chosen-shift
  writer, `collectorDeposits`, codes), `shifts/shift-read.ts` (new: `number` and `actorName` of a shift),
  `shifts/cash-entries.service.ts`, `shifts/shifts.service.ts`, `shifts/shifts.controller.ts`.
- `apps/pos-api/src/store-cash/store-cash-deposits.service.ts`, `store-cash/store-cash.controller.ts`,
  `store-cash/store-cash-ledger.ts` (comment).
- `apps/pos-api/src/reports/reports.service.ts` (one total), `src/guards.spec.ts`.
- No pos-web change: `routes/kasir/-shift-helpers.ts` already folds an unnamed cash-in into "Kas masuk
  lain", so tutup shift still adds up until the follow-up names the "+ Setoran penagih" line.

## Tests
`test/store-cash-deposits.e2e-spec.ts` (rewritten expectations, new cases), `test/cash-entries.e2e-spec.ts`
(codes, `shiftId`, actor fields), `test/void.e2e-spec.ts` and `test/expenses.e2e-spec.ts` (markers),
`src/shifts/cash-ledger.spec.ts`, `src/store-cash/store-cash-deposits.spec.ts` (new, agent),
`src/guards.spec.ts`.
