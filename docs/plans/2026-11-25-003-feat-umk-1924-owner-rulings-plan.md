# UMK-1924: five owner rulings of 2026-11-25 (U5 reports, expenses, units and wholesale)

Epic UMK-1924, unit U5 (reports, UMK-1984) and the U2/U3 pricing of UMK-1985. The owner answered the open
questions of plans `2026-11-25-001` (expenses, profit and loss) and `2026-11-25-002` (units and wholesale)
on 2026-11-25: every recommendation is taken.

## Goal (the five rulings)
1. **Gross profit excludes tax everywhere** (profit and loss, dashboard, sales reports). Tax is money held
   for remittance, never earned. This replaces "P&L revenue includes tax". In the profit and loss report
   `revenue` ("Hasil jualan") is now Σ sale totals − tax, so revenue − cost = gross profit still holds on
   the screen; `tax` stays its own line outside the sum, `taxIncluded` is `false`, and the labels say
   "tanpa pajak". Cash rounding stays outside revenue and profit. The dashboard and the sales reports
   already took tax out of `grossProfit`; their `revenue` field keeps its meaning (Σ sale totals).
2. **Void of a drawer expense whose shift is closed:** the cash goes into the store cash ("kas toko"), one
   `expense_void` cash-in entry (`ref_id` = the expense, actor = whoever voided). The closed shift never
   changes. A shift still open keeps the drawer reversal. The expense answers `cashReturnedTo`:
   `drawer` | `store_cash` | `null`.
3. **Own rows only with `expenses.manage` alone:** list, summary totals, CSV, detail, update and void work on
   the expenses the actor recorded (`actor_id` = the session's actor); another actor's id answers 404.
   Holders of `reports.view` (and owners, who hold everything) work on the whole log. The profit and loss
   report (already `reports.view`) always covers the store.
4. **Dus price warning** compares a unit's price with `unitQty ×` the price per base unit **of the tier that
   `unitQty` itself reaches** (the base price when it reaches none), not with the cheapest tier. The design
   example (dus 78.000, 24 pcs, tier 12+ = 3.300 → 79.200) gives no warning.
5. **A manual price on a base-unit line** (a client price, honoured with `sales.price_override`) is a manual
   price, not wholesale: `appliedTier` null and `savings` 0 on that line, `normal_unit_price` stays the
   product's price, `list_price` stays the server's price. Sale and receipt lines carry `manualPrice`
   (from `price_overridden_by`). The line's base quantity still counts toward the product's total.

## Decisions
- No migration: `expense_void` is a new value of the text column `store_cash_entries.kind`;
  `cashReturnedTo` is read from the ledger; `manualPrice` from `sale_lines.price_overridden_by`.
- The store cash entry is written in the void's transaction by `recordStoreCash`; the unique index
  `(tenant_id, kind, ref_id)` and the expense row lock keep it to one.
- A voided expense from before this change (closed shift, no store cash entry) answers
  `cashReturnedTo: null`: nothing is invented for it.
- A scoped actor who replays another actor's `Idempotency-Key` is refused (422), never shown that expense.
- `GET /expenses/categories` is a fixed list without totals: unchanged.

## Definition of Done
- [test] Profit and loss fixture by hand: revenue 37.250 (39.475 − 2.225 tax), gross 16.550, net −450;
  `taxIncluded: false`; labels and CSV lines say "tanpa pajak"; gross profit equals the dashboard's and the
  sales report's totals; rounding outside.
- [test] Void, closed shift: one store cash entry `in`/`expense_void` for the amount, by the voider; the
  closed shift row and the shift ledger unchanged; the open drawer unchanged; repeat writes nothing; the
  race "void after close" lands in store cash. Void, open shift: drawer reversal, no store cash entry.
  Store B sees nothing of it in its store cash and gets 404 on the void.
- [test] Scope: two cashiers with `expenses.manage` each see only their rows in list, summary and CSV; 404
  on the other's detail, update and void (nothing changed); a `reports.view` holder and the owner see all;
  cross-tenant 404 stays.
- [test] Warning: the design example gives none; 79.201 warns against 79.200; a pack of 48 is compared with
  the 48+ tier; a pack below the first tier with the base price (pure spec and e2e).
- [test] Manual price on a tiered pcs line: `appliedTier` null, `savings` 0, `normalUnitPrice` 3.500,
  `listPrice` 3.300, `manualPrice` true on sale and receipt; a line without override keeps its tier and
  `manualPrice` false.
- [test] Revert-red, once each: P&L gross with tax inside; no store cash entry on the closed-shift void;
  scope dropped from read; cheapest tier in the warning; tier kept on an overridden line.
- [cmd] `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=pos_rulings npx jest --runInBand`
  in `apps/pos-api`; `npx vitest run` in `apps/pos-web`.
- [qa] Screens in a browser: not done here.

## Files
- `apps/pos-api/src/expenses/profit-loss.service.ts`, `expenses.service.ts`, `expenses.controller.ts`;
  `src/reports/reports.service.ts` (comment only); `src/db/schema/store-cash.ts` (one kind).
- `apps/pos-api/src/catalog/pricing.ts`; `src/sales/sales.service.ts`.
- `apps/pos-web/src/routes/laporan/untung-rugi.tsx`, `pengeluaran/$id.tsx`, `pengeluaran/-api.ts`,
  `kasir/-shift-helpers.ts` (store cash label), `kasir/-helpers.ts` + receipt screens (manual price note).
- Plans `2026-11-25-001` and `-002`: wording brought in line.

## Tests
`apps/pos-api/test/expenses.e2e-spec.ts`, `test/units-wholesale.e2e-spec.ts`,
`src/catalog/pricing.spec.ts`; pos-web helper tests where a helper changes.
