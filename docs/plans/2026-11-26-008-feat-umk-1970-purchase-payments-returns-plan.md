# UMK-1970: purchase payment status, due dates, supplier payments and returns (design feature 29)

Goal: an approved purchase is a debt to its supplier. The owner sees what is still owed per purchase and in total, pays
the supplier (from the drawer or from outside it) and returns goods, and the purchase's payment status follows from
those records. Design: "Pembelian: status bayar, jatuh tempo, bayar pemasok, retur" (feature 29, approved). Builds on
the U6 purchasing module and the shift cash ledger (UMK-1963, UMK-2016).

## Rulings taken here (design names them, or they follow from the rules)

- Debt of a purchase = total - returns - live payments, floored at 0. Status: `lunas` when nothing is owed, `sebagian`
  when something was paid, else `belum_bayar`. `terlambat` (late) is a flag on top: not `lunas`, a due date before the
  store's today (store timezone). No due date: never late. Drafts and cancelled purchases have no payment status.
- A payment is at most the debt (`PURCHASE_OVERPAY`, also for a paid-in-full purchase). It locks the purchase row and
  takes an `Idempotency-Key` (same key + same body answers the first payment; another body or another actor is
  `IDEMPOTENCY_KEY_REUSED`).
- Source `drawer` (Laci kasir): the actor's own open shift (`SHIFT_REQUIRED`), enough expected drawer cash
  (`DRAWER_INSUFFICIENT`), and the permission that holds a drawer (`sales.create`); writes one shift cash entry of the
  new kind `purchase_payment`. Source `outside` (Di luar laci) touches no drawer. Not an expense: not in profit and loss.
- Payments and returns are never edited or deleted. A payment is corrected by voiding it (reason kept, a reversal line
  in the history): a drawer payment whose shift is still open gets a `purchase_payment_reversal` cash-in entry in that
  shift; a closed shift never changes, the cash goes to the store cash (`purchase_payment_void`), as voided drawer
  expenses do (owner ruling 2026-11-25).
- A return picks lines of the purchase and quantities up to what is left in that line's stock batch
  (`RETURN_EXCEEDS_BATCH`), draws exactly that batch through StockService under its row lock (reason
  `purchase_return`), and lowers the debt by batch cost x qty. Sold goods keep their cost. A return worth more than
  the debt is allowed: the debt stops at 0 and the difference is stored as money due back from the supplier, outside
  the system (a note in the history).
- Due date: optional, set at creation and editable while the purchase is a draft or approved.
- Number `PB-0001` per store (stored at creation; existing purchases numbered by creation order in the migration).
- Permissions: `purchasing.manage` for paying, returning and voiding (no new key, so no role migration); amounts stay
  hidden from actors without `purchasing.manage` / `reports.view`, as purchase totals already are. The agent reaches no
  purchasing route; a drawer payment by an agent kind would be refused by the cash ledger anyway.

## Definition of Done

1. [test] Design example: PB total Rp2.400.000, paid Rp1.000.000 from the drawer, remaining Rp1.400.000, status
   `sebagian`; a return of 10 pcs at Rp2.800 lowers the debt by Rp28.000 (remaining Rp1.372.000) and stock by 10.
2. [test] Overpay refused with `PURCHASE_OVERPAY` (and on a `lunas` purchase); revert-red once.
3. [test] Drawer source: no shift → `SHIFT_REQUIRED`; drawer cash below the amount → `DRAWER_INSUFFICIENT`
   (revert-red once); the shift's expected cash drops by the amount; an outside payment leaves it.
4. [test] Idempotent replay answers the first payment; two concurrent payments of the whole debt: one 201, one
   `PURCHASE_OVERPAY`.
5. [test] Return over the batch's remaining stock refused (`RETURN_EXCEEDS_BATCH`), after a sale drew from it.
6. [test] Status transitions belum bayar → sebagian → lunas, late flag from a past due date, list filters data and
   the debt summary (total, late, due in 7 days); draft refuses payment and return.
7. [test] Void of a drawer payment: open shift gets the reversal; closed shift unchanged and store cash gets it.
8. [test] Cross-tenant 404 for every new route (pay, return, void, detail history); 403 without `purchasing.manage`.
9. [test] Guard: purchase payments, returns and their ledger kinds are written only in their service.
10. [test] pos-web vitest for the pure helpers (status label, debt after return, amount cap, code to text).
11. [cmd] `npm run lint && npm run typecheck && npm run build`, pos-web `npx vitest run`, pos-api full run.
12. [qa] Browser at 375 and 1024: list with filters and summary, detail, pay, return, toast and error dialog.

## Files

- api: `src/db/schema/purchasing.ts` (columns, `purchase_payments`, `purchase_returns`, `purchase_return_lines`),
  `src/db/schema/shift-cash.ts`, `store-cash.ts`, `stock.ts` (kinds and reason), one migration,
  `src/purchasing/purchase-payments.service.ts` (new), `purchasing.service.ts`, `purchasing.controller.ts`,
  `src/stock/stock.service.ts` (`returnToSupplier`), `src/shifts/cash-ledger.ts` (totals), `src/guards.spec.ts`.
- web: `routes/pembelian/` (list, detail, pay and return dialogs, helpers + tests), `routes/kasir/-shift-helpers.ts`
  (drawer row labels).
- tests: `test/purchase-payments.e2e-spec.ts`.
