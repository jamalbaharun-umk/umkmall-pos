# Test cases: expenses and P&L, stock on the cashier grid, units and wholesale pricing

Scope: designs 1, 2 and 3 (Linear UMK-1984, UMK-1966, UMK-1985). Money behaviour that touches the drawer
(expense from drawer, supplier payment) is cross-checked in `01-payments-money.md`.

Legend: `[auto-api]` automated API test (supertest, `apps/pos-api/test/*.e2e-spec.ts`), `[auto-ui]` browser
test (Playwright), `[manual]` run by a person. Priority P0 = blocks the local E2E sign-off (UMK-1975).
API names marked *(assumed)* are guesses until the engineer's routes land; adjust when they do.

Test data used below (create once per store, see `00-local-setup.md`):

| Product | Base unit | Cost | Price | Extra unit | Wholesale |
|---|---|---|---|---|---|
| Teh Botol 350ml | pcs | Rp2.000 | Rp3.500 | dus = 24 pcs, Rp78.000 | >=12 pcs Rp3.300, >=48 pcs Rp3.200 |
| Minyak Goreng 1L | pcs | Rp11.000 | Rp14.000 | none | none |
| Indomie Goreng | pcs | Rp2.400 | Rp3.000 | none | none |
| Kopi Seduh (service) | cup | Rp0 | Rp8.000 | none | none (stock tracking off) |

---

## A. Expenses and simple P&L (design 1)

Invariants: integer rupiah; server computes every total; P&L uses the cost stored on each sale line; paying a
supplier is a separate record and is not counted again as an expense; day boundaries follow the store timezone.

| ID | Pri | Type | Case | Expected |
|---|---|---|---|---|
| EXP-001 | P0 | auto-api | Create expense Rp45.000, category Listrik & air, source "drawer", open shift | 201; listed under today; expected drawer cash drops by Rp45.000 immediately |
| EXP-002 | P0 | auto-api | Create expense with source "outside drawer" | 201; drawer expected cash unchanged; P&L expenses +amount |
| EXP-003 | P0 | auto-api | Drawer expense with no open shift | Blocked with a clear Indonesian message (no silent record); no row created |
| EXP-004 | P0 | auto-api | Outside-drawer expense with no open shift | Allowed (no drawer involved) |
| EXP-005 | P0 | auto-api | Same request twice with the same Idempotency-Key | One expense only; second call returns the first result |
| EXP-006 | P0 | auto-api | Amount Rp0, negative, decimal (1500.5), string, missing, > max safe integer | 422 each, never 500; no float stored |
| EXP-007 | P1 | auto-api | Amount Rp1 and Rp999.999.999 | Accepted; totals exact |
| EXP-008 | P0 | auto-api | Drawer expense larger than expected drawer cash (drawer has Rp1.390.000, expense Rp1.500.000) | Warning shown/returned; saving still allowed only after explicit confirmation; once saved expected cash is negative-visible and the close-shift screen shows it |
| EXP-009 | P1 | auto-api | Category not in list / empty / 300-char note | 422 for bad category; note length limit enforced with 422 |
| EXP-010 | P0 | auto-api | Cashier WITHOUT `expenses.manage` creates/lists/edits expense | 403 for create/update/delete; list hidden |
| EXP-011 | P0 | auto-api | Cashier WITHOUT `expenses.manage` opens P&L / profit report | 403; cashier sees no profit numbers anywhere (also on dashboard and shift report) |
| EXP-012 | P0 | auto-api | Owner holds every permission | Can do all of EXP-001..EXP-011 |
| EXP-013 | P0 | auto-api | Cross-tenant: store B reads, updates, deletes store A's expense id | 404 on all three; store B list never contains A's rows |
| EXP-014 | P1 | auto-api | Tenant id sent in body/query | Ignored/rejected; tenant always from session |
| EXP-015 | P1 | auto-api | Edit an expense amount after the shift closed | Closed shift totals are never changed; the edit is rejected or recorded in the open shift per engineer's decision (**open decision**: confirm) |
| EXP-016 | P1 | auto-api | Delete (or void) a drawer expense | Drawer expected cash restored in the current open shift, audit row kept; closed shift untouched |
| EXP-017 | P0 | auto-api | Agent session records expense "outside drawer" (after confirm) | Allowed; actor kind `agent` stored; drawer unchanged |
| EXP-018 | P0 | auto-api | Agent session records expense "drawer" | Refused with a short Indonesian message; nothing stored |
| EXP-019 | P1 | auto-ui | Expense list tabs Hari ini / Minggu ini / Bulan ini | Totals match sum of rows; grouped by day; "via agent" badge for agent rows |
| EXP-020 | P1 | auto-ui | Loading, empty, error states on list and form | Skeleton; "Belum ada pengeluaran"; error keeps typed data on screen |
| EXP-021 | P1 | auto-ui | Double tap Simpan | One row |

P&L (formula: revenue - COGS = gross profit; gross profit - expenses = net profit):

| ID | Pri | Type | Case | Expected |
|---|---|---|---|---|
| PNL-001 | P0 | auto-api | Design example: revenue Rp9.800.000, COGS Rp6.900.000, expenses Rp760.000 | Gross Rp2.900.000; net Rp2.140.000 |
| PNL-002 | P0 | auto-api | One sale 3 x Es Teh (price Rp5.000, cost Rp2.000), one expense Rp4.000 | Revenue 15.000; COGS 6.000; gross 9.000; net 5.000 |
| PNL-003 | P0 | auto-api | Change product cost from Rp2.000 to Rp2.500 AFTER the sale | Old sale COGS still 6.000 (stored line cost, not current); new sales use 2.500 |
| PNL-004 | P0 | auto-api | Supplier payment Rp500.000 (drawer) | Not in P&L expenses (COGS already counted); drawer expected cash -500.000; no double count |
| PNL-005 | P0 | auto-api | Kasbon sale Rp6.000 then Rp2.500 instalment | Revenue +6.000 once at sale time; instalment does not add revenue again |
| PNL-006 | P0 | auto-api | Void a sale (see PAY group) | Revenue, COGS and profit reverse exactly by the stored values |
| PNL-007 | P0 | auto-api | Sale with discount and 11% tax | Revenue definition used by P&L is the same number as the sales report (**check which: net of tax?** record the decision) |
| PNL-008 | P0 | auto-api | Day boundary: sale at 23:59:59 and one at 00:00:01 store time (Asia/Jakarta, UTC+7), expense at 23:30 | Each lands in its own store day regardless of server UTC; week/month filters same |
| PNL-009 | P1 | auto-api | Week starts Monday vs Sunday | Matches documented rule, same on API and UI |
| PNL-010 | P1 | auto-api | Month with 31 days, leap-year February | Ranges inclusive of last day |
| PNL-011 | P0 | auto-api | Negative net profit (expenses > gross profit) | Shown as negative rupiah, no crash, no rounding |
| PNL-012 | P1 | auto-api | Empty range | All zeros; empty state in UI |
| PNL-013 | P1 | auto-api | Product with no stored cost (Rp0 cost, service) | COGS 0, profit = price |
| PNL-014 | P1 | auto-api | Large volume: 10.000 sale lines in month | Totals exact; response < 2 s locally |
| PNL-015 | P0 | auto-api | Cross-tenant: store B P&L never includes store A rows | Verified with both stores having data |
| PNL-016 | P1 | auto-ui | "Pengeluaran terbesar" bars | Order and percentages match data; top item 100% |
| PNL-017 | P1 | auto-api | Report totals equal sum of daily rows | Zero drift across filters |

## B. Stock on the cashier grid and catalog (design 2)

Invariants: displayed number is a hint; the server decides inside the sale transaction (row lock or atomic
`update ... where qty >= n`); stock stored in base unit.

| ID | Pri | Type | Case | Expected |
|---|---|---|---|---|
| STK-001 | P0 | auto-api | Products list returns stock for each product | Number matches stock ledger |
| STK-002 | P0 | auto-ui | Stock above low threshold | Small grey "Stok 48" |
| STK-003 | P0 | auto-ui | Stock <= low threshold (default 5, per-product setting) | Yellow "Sisa 3" |
| STK-004 | P0 | auto-api | Boundary: stock 5 and 6 with threshold 5 | 5 = low, 6 = normal (state which side is inclusive in the code, then keep it consistent in API and UI) |
| STK-005 | P0 | auto-ui | Stock 0 | Red "Habis", card dimmed; tap shows message, not silence |
| STK-006 | P0 | auto-ui | Service / non-tracked product | "Tanpa stok", never out |
| STK-007 | P0 | auto-api | Sell qty > stock (4 of stock 3) | 409/422 with clear message; no stock change, no sale row |
| STK-008 | P0 | auto-ui | Cart quantity above stock | Row warning; Bayar disabled until fixed |
| STK-009 | P0 | auto-api | Concurrency: two cashiers sell the last unit simultaneously | Exactly one succeeds; stock ends at 0, never -1 |
| STK-010 | P0 | auto-api | Stock decreases by exact qty on success; restored on void | Verified through catalog and stock ledger |
| STK-011 | P1 | auto-api | Negative stock "jual tetap" mode | Not available (design: sale blocked); decision is open for a store setting, test only the blocked behaviour |
| STK-012 | P1 | auto-api | Stale grid: grid shows 3, another device sold 3 | Pay returns a clear conflict message; cart kept |
| STK-013 | P0 | auto-api | Filter Menipis / Habis in catalog | Counts equal rows; tracked-off products excluded |
| STK-014 | P1 | auto-api | Purchase received / stock opname adjust updates the grid number | Next products call shows new stock |
| STK-015 | P0 | auto-api | Cross-tenant: stock of store A not readable/adjustable by B | 404 |
| STK-016 | P1 | auto-ui | Phone width 360 px | No horizontal scroll; badges readable; touch targets >= 44 px |
| STK-017 | P1 | auto-ui | Loading, empty (no products), error | Each state present, Indonesian copy |
| STK-018 | P1 | auto-api | Low-threshold setting 0, negative, decimal, huge | 422 on invalid |

## C. Units and wholesale pricing (design 3)

Invariants: server picks unit and tier; client price ignored unless `sales.price_override`; stock in base unit;
tax after discount; cost per base unit stored on the line.

Worked numbers (price per pcs Rp3.500; dus Rp78.000 = 24 pcs; tiers >=12 Rp3.300, >=48 Rp3.200; cost Rp2.000/pcs):

| Qty (pcs, loose) | Unit price | Line total | Stock change | Cost stored |
|---|---|---|---|---|
| 1 | 3.500 | 3.500 | -1 | 2.000 |
| 11 | 3.500 | 38.500 | -11 | 22.000 |
| 12 | 3.300 | 39.600 | -12 | 24.000 |
| 47 | 3.300 | 155.100 | -47 | 94.000 |
| 48 | 3.200 | 153.600 | -48 | 96.000 |
| 1 dus | 78.000 | 78.000 | -24 | 48.000 |
| 2 dus | 78.000 each | 156.000 | -48 | 96.000 |

| ID | Pri | Type | Case | Expected |
|---|---|---|---|---|
| UNT-001 | P0 | auto-api | Create product with extra unit dus (24, Rp78.000) and two tiers | Saved; GET returns same values |
| UNT-002 | P0 | auto-api | Sale 11 pcs / 12 pcs / 47 pcs / 48 pcs | Rows of the table above, exact |
| UNT-003 | P0 | auto-api | Sale 1 dus and 2 dus | 78.000 / 156.000; stock -24 / -48 |
| UNT-004 | P0 | auto-api | Client sends unitPrice 1 for a 12 pcs line, cashier without override | Ignored; line uses 3.300 |
| UNT-005 | P0 | auto-api | Same with `sales.price_override` holder | Override accepted, `priceOverriddenBy` recorded |
| UNT-006 | P0 | auto-api | Design cart: 12 pcs (39.600) + 1 dus (78.000), 11% tax, no discount | Subtotal 117.600; tax 12.936; total 130.536 |
| UNT-007 | P0 | auto-api | Same cart with a Rp10.000 discount (tax after discount) | Taxable 107.600; tax 11.836; total 119.436. Verify 107.600 x 0.11 = 11.836 exactly |
| UNT-008 | P0 | auto-api | Tax rounding: taxable Rp1.234 at 11% (135,74) | Deterministic integer rule, documented, same on receipt, report, void |
| UNT-009 | P0 | auto-api | Mixed cart, same product, 6 loose pcs + 1 dus: does the wholesale tier count combined quantity? | **Open question for engineer/owner.** Record the rule that is built; test it both ways |
| UNT-010 | P0 | auto-api | Loose 24 pcs (79.200 at tier 3.300) vs 1 dus (78.000) | Both allowed; no automatic switch to cheaper dus unless specified; record behaviour |
| UNT-011 | P0 | auto-api | Void a wholesale line | Stock +24 for dus, +12 for 12 pcs; revenue/COGS reverse by stored values |
| UNT-012 | P0 | auto-api | Change dus price after a sale | Old sale line unchanged |
| UNT-013 | P0 | auto-api | Remove a unit/tier used by past sales | Past sales intact; either blocked or soft-removed |
| UNT-014 | P0 | auto-api | Validation: units/tiers with 0, negative, decimal pack size; dus price lower than tier x pack (allowed but warned?); two tiers same threshold; thresholds not ascending; tier price above base price | 422 with field message; no 500 |
| UNT-015 | P1 | auto-api | Dus price Rp78.000 -> "hemat" label = 24 x 3.500 - 78.000 = 6.000 | UI figure equals server-computed value |
| UNT-016 | P1 | auto-ui | Unit chooser sheet, quantity field, "Tambah ke pesanan" | Correct line label "12 pcs x Rp3.300 + Harga grosir" and "hemat Rp2.400" (12 x 3.500 - 39.600) |
| UNT-017 | P1 | auto-ui | Hint "Tambah 36 pcs lagi untuk harga Rp3.200" at 12 pcs | 48 - 12 = 36 |
| UNT-018 | P0 | auto-api | Stock check on dus: 1 dus with stock 23 pcs | Blocked; 24 pcs allowed |
| UNT-019 | P0 | auto-api | Product without extra units behaves exactly as before | Regression: existing sale tests still pass |
| UNT-020 | P0 | auto-api | Cross-tenant on units/tiers read/update/delete | 404 |
| UNT-021 | P1 | auto-api | Idempotent sale retry with a wholesale cart | One sale; stock moved once |
| UNT-022 | P1 | auto-api | Barcode/SKU search still finds product via unit | Defined behaviour documented |
| UNT-023 | P1 | auto-api | Upper bound: 1.000.000 pcs sale | No overflow; integers stay safe |
