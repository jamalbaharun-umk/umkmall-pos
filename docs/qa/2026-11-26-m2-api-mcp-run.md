# M2 local end-to-end run: API and MCP part (UMK-1975)

Run on 26 Nov 2026 (final run `253d2303`, 12:14 UTC). It uses the real HTTP API of a locally started stack, with no
browser. The browser part of [the checklist](2026-11-26-m2-local-e2e-checklist.md) is still to be run on the owner's
Mac.

**Result: 145 of 146 checks pass. One failure, filed as [UMK-2069](https://linear.app/umkmall/issue/UMK-2069)
(low).** The same script against pos-api with payment-api off (the default local setup, online sale skipped): 137
of 138 pass, with the same single failure.

## What ran

| Piece | How |
|---|---|
| Code | `main` at `6bc7390`, built with `npm run build -w pos-api -w payment-api` |
| Database | A private Postgres 16 cluster on port 5575 (the container has no Docker). Databases `pos_qa75` (pos) and `pay_qa75` (payment), made with `ops/local-public-users.sql`, `ops/pos-role.sql`, `ops/payment-role.sql`, then both `db:migrate` (pos 44, payment 5). A second pos database `pos_qa75b` was used for the payment-off run |
| payment-api | `node dist/main`, `NODE_ENV=development PAYMENT_ADAPTERS=fake`, port 3375 |
| pos-api | `node dist/main`, `NODE_ENV=development`, port 3370, `PAYMENT_API_URL` set (payment-off run: port 3372, unset) |
| pos-web | `vite dev --port 3371`, with `POS_DEV_USER_ID`. Only to check the setup: `POST /masuk/dev` answered 303 with the `pos_session` cookie. Every route in `nav.ts`, plus the `baru` pages, answered 200 with it (`/pengeluaran` and `/laporan/untung-rugi` answer 307 to `?period=today`). `/laporan/csv/penjualan` relayed `text/csv` |
| Script | [`scripts/qa/m2-api-mcp-run.mjs`](../../scripts/qa/m2-api-mcp-run.mjs) (usage in its header). It creates three stub UMKMall users, signs each in with `POST /auth/dev/sign-in`, and drives store A (owner, a cashier on a device paired by code, a collector), store B (isolation) and store C (the agent over MCP with `@modelcontextprotocol/sdk`, then the owner's REST reports) |

```bash
POS_API_URL=http://localhost:3370 QA_ADMIN_DATABASE_URL=postgres://pos:…@localhost:5575/pos_qa75 \
PAYMENT_API_URL=http://localhost:3375 PAYMENT_SERVICE_KEY=… QA_OUT=.evidence/m2-api-mcp-run.json \
node scripts/qa/m2-api-mcp-run.mjs
```

Evidence: `.evidence/m2-api-mcp-run.json` (every check with its observed value, the report totals) and
`.evidence/m2-api-mcp-run.txt` (console output), 56 KB together. `.evidence/` is git-ignored, so they are kept in
the worktree only. The table below copies every check.

## The scenario and its numbers

Store A has tax 10%. Products: Teh Botol 5.000 (cost 3.000, dus of 12 at 54.000, wholesale 4.500 from 10), Beras 5kg
75.000 (60.000), Gula 1kg 16.000 (13.000), Kerupuk 2.750 (2.000). The cashier Budi signed in with his PIN on a device
paired by code, and opened a shift with 200.000.

| Sale | Content | Observed |
|---|---|---|
| S1 cash | Teh 3 + Kerupuk 1 | subtotal 17.750, tax 1.775, total 19.525, rounding 75, due 19.600, paid 20.000, change 400, cost 11.000 |
| S2 cash | 1 dus + 10 PCS Teh | 54.000 + 10 × 4.500 (tier reached by 22 base units) = 99.000, tax 9.900, total 108.900, change 1.100, cost 66.000 |
| S2b cash | Teh 1 with `price: 1` sent by the cashier (no `sales.price_override`) | price ignored: 5.000, total 5.500, cost 3.000 |
| S3 debit | Beras 2, voucher `diskon10` | 150.000 − 15.000, tax 13.500 (after the discount), total 148.500, cost 120.000 |
| S4 kasbon | Beras 1, Ibu Rina, down payment 20.000 | total 82.500, kasbon rest 62.500 (refused first without a member: 422) |
| S5 cash | Gula 2 | 35.200, then voided with the owner's PIN (a wrong PIN first: 422). Status `void`, Gula back to 20 |
| S6 online | Gula 1, fake QRIS | `awaiting_payment` 17.600 → bill paid at the fake gateway → `completed` → void refused 409 `use_refund` → refund → `void`, Gula back |

After the sales: kasbon payment 30.000 at the till (70.000 refused as above the balance), so the rest is 32.500. The
collector Sari (role Penagih, no `sales.create`, no shift) took 12.500, held by her. Her own deposit was refused, and
Budi received it into his drawer, so the rest is 20.000. Drawer cash: +50.000 tambah modal, −100.000 setor bank.
Drawer expense: 10.000 listrik. Stock opname Kerupuk: system 9, counted 8, difference −1, stock 8.

Shift: opening 200.000, cash sales 189.200, kasbon payments 30.000, deposit 12.500, in 50.000, out 100.000, void
35.200, expenses 10.000. **Expected 336.500**, counted 336.000, **difference −500**.

Reports for the day (owner): salesCount 5, grossSales 346.750, voucher 15.000, tax 33.175, **revenue 364.925**, cost
260.000, **gross profit 71.750**, rounding 75, voidCount 2. Products: Teh 26 base units, Beras 3, Kerupuk 1 (Gula sold
and reversed nets out). The dashboard equals the sales report. Shifts: Budi, difference −500. Purchasing 1.024.000.
Profit and loss: revenue without tax 331.750, COGS 260.000, gross 71.750, expenses 10.000, **net 61.750** (recorded before UMK-2072 "Susut stok"; the script now expects Susut stok 2.000 and **net 59.750**). All six
CSVs (`/reports/{sales,products,shifts,purchasing,profit-loss}/csv`, `/expenses/csv`) answer `text/csv` with the same
totals.

Store C was filled by the agent over MCP. It created a category and two products (each a preview first, then a
confirm; a replay answered the same id). The owner received the stock in REST, because no MCP tool exists for it.
Then `open_shift` 100.000 and `record_sale` Kopi 2 + Roti 3 = 49.500 (preview quote 49.500 / wouldPay 49.500; a
replay answered the same sale), then Roti 1 = 8.500. MCP `sales_report`, `product_report`, `store_summary`,
`profit_loss` and `current_shift` give 2 sales, 58.000, cost 34.000, gross 24.000, expected cash 158.000. **The owner's
REST `/reports/sales`, `/reports/products`, `/reports/dashboard`, `/reports/profit-loss` and `/shifts/current` answer
exactly the same JSON.** The receipt is the owner's and carries `actorKind: agent`.

## Failures

### UMK-2069: MCP `record_sale` drops a line price instead of refusing it (low)

- Request: MCP `tools/call` `record_sale` with
  `{ "lines": [{ "productId": "<Kopi Susu>", "qty": 1, "price": 1 }], "idempotencyKey": "qa-253d2303-sale-p" }`
  (preview, no confirm).
- Observed: no error. A quote with total **12000** (the server price). On an earlier run the same call with
  `confirm: true` recorded a Rp12.000 sale.
- Expected: `isError: true`, as `POST /sales` refuses `price` for an agent session (docs/agent-integration.md
  section 5: "The agent never sends a price"). The tool's line schema is not strict, so the field is stripped before
  the route sees it. No money risk: the server price is always used.

## Observations (not filed as bugs)

1. **No MCP stock in.** UMK-1975's agent scenario says "stock in". The MCP server has no tool for it
   (agent-integration section 6, "Not yet": purchase drafts belong to the rest of UMK-1980). The run did the stock in
   as the owner in REST. That part of the `[qa]` line cannot pass until such a tool exists.
2. **pos-web has no CSV button for Untung rugi or Pengeluaran.** The API serves `/reports/profit-loss/csv` and
   `/expenses/csv`, but pos-web's `/laporan/csv/$jenis` relays only penjualan, produk, shift and pembelian. If "every
   report and CSV" includes these two, this needs an issue.
3. **A collector must not hold `sales.create`.** A seller without a shift who takes cash for a kasbon is told to
   open a shift ("Buka shift dulu…"). Only a non-seller's cash is held as collector cash. README chapter 22 says
   "someone without an open shift". The checklist uses a dedicated "Penagih" role.
4. **A cashier's sale answer has no `costTotal`.** The owner's read of the same sale has it. This looks deliberate
   (cost is margin data) and is noted only because the run checks cost through the owner.
5. **The opname loss (1 Kerupuk at 2.000) is not in profit and loss.** P&L is sales, cost of goods sold and
   expenses only. This is noted for the owner's review, not as a bug.
6. The sales CSV's `Total` Qty adds lines in their own units (1 dus counts as 1). The products report counts base
   units (26).

## Not exercised here

- Everything in a browser: screens, layouts, phone width, loading, empty and error states, printing, the pairing
  screen moving on by itself, and screenshots. These are parts 1 to 7 and half of part 8 of the checklist.
- UMKMall sign-in (WhatsApp OTP) and the real agent session `POST /auth/agent/session` (needs UMKMall's
  `/api/auth/me`). Only the dev sign-in and `POST /auth/dev/agent-session` were used.
- Agent access revoke and enable, `import_hpp_products`, `add_product_photo`, the kasbon and member MCP writes, and
  the other read tools beyond the ones listed above.
- Online: a VA (`fake_va`), switch to cash, expiry, late money, refund failure and retry, manual refund, and the
  "Perlu ditinjau" list.
- Purge (`POST /internal/tenants/purge`), staff and role editing beyond creation, device revoke, PIN lockout timing,
  product images, store logo and QRIS image, report timezone change, dates other than today.
- `npm test` / the full gate: not run (no product code changed). The script is outside `apps/`.

## Every check

| Id | What | Result | Observed |
|---|---|---|---|
| A.setup.tax | tax set to 10% (taxBps) | pass | `1000` |
| A.catalog.list | product list total after 4 creates | pass | `4` |
| A.purchase.draft | purchase draft status and total | pass | `{"status":"draft","total":1024000}` |
| A.purchase.approve | purchase approved | pass | `approved` |
| A.stock.afterPurchase | on hand Teh/Beras/Gula/Kerupuk after approve | pass | `[48,10,20,10]` |
| A.voidPin.set | owner sets a void PIN | pass | `200` |
| A.roles.default | default roles Pemilik, Admin, Kasir exist | pass | `true` |
| A.pair.code | pairing answers a 6-digit code and a token | pass | `true` |
| A.pair.pending | status before the claim | pass | `pending` |
| A.pair.claim | owner claims the code | pass | `201` |
| A.pair.paired | status after the claim | pass | `paired` |
| A.pair.singleUse | the same code a second time is refused | pass | `422` |
| A.pair.roster | device roster lists Budi and Sari | pass | `true` |
| A.pin.wrong | wrong PIN refused | pass | `401` |
| A.pin.noDevice | PIN sign-in without a paired device refused | pass | `401` |
| A.shift.none | no open shift before opening | pass | `null` |
| A.sale.noShift | sale without an open shift refused | pass | `422` |
| A.shift.open | shift opened with Rp200.000 | pass | `200000` |
| A.S1.cash | cash sale with cash rounding | pass | `{"subtotal":17750,"voucherDiscount":0,"tax":1775,"total":19525,"rounding":75,"amountDue":19600,"paid":20000...` |
| A.S1.idem | same Idempotency-Key answers the first sale | pass | `c4570e4c-3f24-4b52-ae88-5cfc1dfd52a1` |
| A.S2.unitTier | dus + wholesale tier sale | pass | `{"subtotal":99000,"voucherDiscount":0,"tax":9900,"total":108900,"rounding":0,"amountDue":108900,"paid":1100...` |
| A.S2.lines | line prices (dus 54.000, pcs at tier 4.500) | pass | `[["PCS",10,4500,45000],["dus",1,54000,54000]]` |
| A.S2b.noPriceOverride | a cashier-sent price is ignored (server price used) | pass | `[5000,5500]` |
| A.cost.S1-S3 | cost stored per sale (owner read): S1, S2, S2b, S3 | pass | `[11000,66000,3000]` |
| A.S3.voucher | voucher sale paid by debit, tax after discount | pass | `{"subtotal":150000,"voucherDiscount":15000,"tax":13500,"total":148500,"rounding":0,"amountDue":148500,"paid...` |
| A.cost.S3 | cost stored on the voucher sale | pass | `120000` |
| A.S4.needsMember | kasbon without a member refused (422) | pass | `422` |
| A.S4.kasbon | kasbon sale with Rp20.000 down payment | pass | `{"total":82500,"paid":20000,"receivableRest":62500,"memberName":"Ibu Rina","status":"completed"}` |
| A.S5.cash | sale to be voided | pass | `{"total":35200,"amountDue":35200,"change":0}` |
| A.stock.afterSales | on hand Teh/Beras/Gula/Kerupuk after S1-S5 | pass | `[22,7,18,9]` |
| A.void.badPin | void with a wrong admin PIN refused | pass | `422` |
| A.void.ok | void approved by the owner PIN | pass | `201` |
| A.void.status | voided sale status | pass | `void` |
| A.void.stockBack | Gula back to 20 after the void | pass | `20` |
| A.S6.draft | fake gateway draft saved | pass | `200` |
| A.S6.approve | fake gateway approves the account | pass | `200` |
| A.S6.active | merchant account active | pass | `active` |
| A.S6.awaiting | online sale waits for its payment | pass | `{"status":"awaiting_payment","total":17600}` |
| A.S6.bill | fake gateway holds a bill of Rp17.600 | pass | `true` |
| A.S6.paid | online sale completed after the gateway paid | pass | `completed` |
| A.S6.noVoid | a paid online sale cannot be voided (409 use_refund) | pass | `[409,"use_refund"]` |
| A.S6.refund | refund accepted | pass | `201` |
| A.S6.reversed | refunded sale is reversed (void) | pass | `void` |
| A.rec.open | kasbon receivable rest before payments | pass | `62500` |
| A.rec.overpay | payment above the balance refused | pass | `422` |
| A.rec.afterPay | rest after Rp30.000 | pass | `32500` |
| A.collector.held | Sari holds Rp12.500 (outstanding) | pass | `12500` |
| A.collector.noSelf | a collector cannot record her own deposit | pass | `403` |
| A.collector.deposit | Budi receives the deposit | pass | `201` |
| A.collector.handedOver | after the deposit: outstanding 0, handed over 12.500 | pass | `{"outstanding":0,"handedOver":12500}` |
| A.rec.afterCollector | rest after the collector payment | pass | `20000` |
| A.expense.drawer | drawer expense Rp10.000 recorded | pass | `201` |
| A.shift.parts | shift ledger parts before close | pass | `{"openingCash":200000,"cashSales":189200,"receivablePayments":30000,"voidRefunds":35200,"manualIn":50000,"m...` |
| A.shift.expected | expected cash in the drawer | pass | `336500` |
| A.opname.diff | opname line: system 9, counted 8, difference -1 | pass | `[9,8,-1]` |
| A.opname.applied | Kerupuk on hand after approve | pass | `8` |
| A.shift.close | close: expected, counted, difference | pass | `{"expectedCash":336500,"countedCash":336000,"difference":-500}` |
| A.report.sales | sales report totals | pass | `{"salesCount":5,"grossSales":346750,"voucher":15000,"tax":33175,"revenue":364925,"cost":260000,"grossProfit...` |
| A.report.products | products report qty (base units) | pass | `{"Beras 5kg":3,"Kerupuk":1,"Teh Botol":26}` |
| A.report.dashboard | dashboard today = sales report | pass | `{"salesCount":5,"revenue":364925,"grossProfit":71750}` |
| A.report.shifts | shifts report: one shift, Budi, difference −500 | pass | `[["Budi",-500]]` |
| A.report.purchasing | purchasing report total | pass | `1024000` |
| A.report.pl | profit and loss: revenue ex tax, COGS, gross, expenses, net, tax, rounding | pass | `{"revenue":331750,"cost":260000,"grossProfit":71750,"expenses":10000,"netProfit":61750,"tax":33175,"roundin...` |
| A.csv.reports.sales.csv | /reports/sales/csv answers CSV | pass | `{"status":200,"csv":true}` |
| A.csv.reports.products.csv | /reports/products/csv answers CSV | pass | `{"status":200,"csv":true}` |
| A.csv.reports.shifts.csv | /reports/shifts/csv answers CSV | pass | `{"status":200,"csv":true}` |
| A.csv.reports.purchasing.csv | /reports/purchasing/csv answers CSV | pass | `{"status":200,"csv":true}` |
| A.csv.reports.profit-loss.csv | /reports/profit-loss/csv answers CSV | pass | `{"status":200,"csv":true}` |
| A.csv.expenses.csv | /expenses/csv answers CSV | pass | `{"status":200,"csv":true}` |
| A.csv.salesTotals | sales CSV Pendapatan / Laba kotor / Pembulatan | pass | `["364925","71750","75"]` |
| A.csv.productsTeh | products CSV Teh Botol row | pass | `SEM-TEH-0001,Teh Botol,26,119000,78000,41000` |
| A.csv.shift | shifts CSV: expected, counted, difference | pass | `["336500","336000","-500"]` |
| A.csv.purchasing | purchasing CSV total | pass | `1024000` |
| A.csv.pl | profit-loss CSV net profit | pass | `61750` |
| B.sale | store B own sale | pass | `2000` |
| B.x.catalog/products | store B on store A's catalog/products id: read/update/delete | pass | `[404,404,404]` |
| B.x.catalog/categories | store B on store A's catalog/categories id: read/update/delete | pass | `[404,404,404]` |
| B.x.suppliers | store B on store A's suppliers id: read/update/delete | pass | `[404,404,404]` |
| B.x.members | store B on store A's members id: read/update/delete | pass | `[404,404,404]` |
| B.x.vouchers | store B on store A's vouchers id: read/update/delete | pass | `[404,404,404]` |
| B.x.payment-methods | store B on store A's payment-methods id: read/update/delete | pass | `[404,404,404]` |
| B.x.purchasing/orders | store B on store A's purchasing/orders id: read/update/delete | pass | `[404,404,404]` |
| B.x.stock-opnames | store B on store A's stock-opnames id: read/update/delete | pass | `[404,404,404]` |
| B.x.staff | store B on store A's staff id: read/update/delete | pass | `[404,404,404]` |
| B.x.sale | store B reads store A's sale | pass | `404` |
| B.x.receipt | store B reads store A's receipt | pass | `404` |
| B.x.receivable | store B reads store A's receivable | pass | `404` |
| B.x.shift | store B reads store A's shift | pass | `404` |
| B.x.stock | store B reads store A's stock | pass | `404` |
| B.x.movements | store B reads store A's movements | pass | `404` |
| B.x.void | store B reads store A's void | pass | `404` |
| B.x.voidA | store B voids store A's sale | pass | `404` |
| B.x.payA | store B pays store A's kasbon | pass | `404` |
| B.x.sellA | store B sells store A's product | pass | `422` |
| B.x.voucherA | store A's voucher code in store B | pass | `422` |
| B.list.catalog.products | store B list /catalog/products shows only B | pass | `only B` |
| B.list.catalog.categories | store B list /catalog/categories shows only B | pass | `only B` |
| B.list.sales | store B list /sales shows only B | pass | `only B` |
| B.list.suppliers | store B list /suppliers shows only B | pass | `only B` |
| B.list.members | store B list /members shows only B | pass | `only B` |
| B.list.vouchers | store B list /vouchers shows only B | pass | `only B` |
| B.list.receivables | store B list /receivables shows only B | pass | `only B` |
| B.list.purchasing.orders | store B list /purchasing/orders shows only B | pass | `only B` |
| B.list.stock-opnames | store B list /stock-opnames shows only B | pass | `only B` |
| B.list.staff | store B list /staff shows only B | pass | `only B` |
| B.list.shifts | store B list /shifts shows only B | pass | `only B` |
| B.list.store-cash.collectors | store B list /store-cash/collectors shows only B | pass | `only B` |
| B.list.store-cash.deposits | store B list /store-cash/deposits shows only B | pass | `only B` |
| B.list.payment-methods | store B list /payment-methods shows only B | pass | `only B` |
| B.list.expenses | store B list /expenses shows only B | pass | `only B` |
| B.report.sales | store B sales report = its one sale | pass | `{"salesCount":1,"revenue":2000}` |
| B.report.purchasing | store B purchasing report empty | pass | `0` |
| B.csv.sales | store B sales CSV has none of store A | pass | `false` |
| B.x.tenantParam | a tenantId query parameter is ignored | pass | `1` |
| B.x.cashierA | store A's cashier sees store A's catalog only | pass | `false` |
| C.agent.session | agent session for the same store | pass | `d05f5217-ee7a-478a-9161-d93bf0261def` |
| C.mcp.tools | tools/list = the tools of docs/agent-integration.md, in order | pass | `["business_context","search_products","get_product","get_product_stock","list_categories","store_summary","...` |
| C.mcp.ownerToken | an owner token on /mcp refused (403) | pass | `403` |
| C.mcp.context | business_context of an empty store | pass | `0` |
| C.mcp.catPreview | create_category without confirm is a preview | pass | `true` |
| C.mcp.catDone | create_category confirmed, with provenance | pass | `[true,"agent"]` |
| C.mcp.products | two products created by the agent | pass | `[true,true]` |
| C.mcp.productReplay | same key and input answers the first product | pass | `e6ac739f-4cff-4b04-97eb-3dc55d2f5a0b` |
| C.mcp.stock | get_product_stock after the purchase (Kopi) | pass | `20` |
| C.mcp.saleNoShift | record_sale with no open shift refused | pass | `true` |
| C.mcp.openShift | open_shift confirmed | pass | `100000` |
| C.mcp.salePreview | record_sale preview quote total and wouldPay | pass | `[true,49500,49500]` |
| C.mcp.sale1 | record_sale confirmed: total, paid, cost | pass | `{"total":49500,"paid":49500,"change":0,"costTotal":29000,"status":"completed"}` |
| C.mcp.saleReplay | record_sale replay answers the same sale | pass | `41012be0-ff83-498f-9fc8-1237c665f5bf` |
| C.mcp.noPrice | record_sale refuses a line price sent by the agent | **FAIL** | `accepted: preview total 12000` |
| C.mcp.sale2 | second sale total | pass | `8500` |
| C.mcp.salesReport | MCP sales_report totals | pass | `{"salesCount":2,"revenue":58000,"cost":34000,"grossProfit":24000}` |
| C.mcp.noCashier | MCP sales_report lines carry no cashier name | pass | `false` |
| C.mcp.productReport | MCP product_report qty | pass | `{"Kopi Susu":2,"Roti Bakar":4}` |
| C.mcp.summary | MCP store_summary today | pass | `{"salesCount":2,"revenue":58000,"grossProfit":24000}` |
| C.mcp.shift | MCP current_shift expected cash | pass | `158000` |
| C.mcp.ledger | MCP ledger_entries: two sales in, Rp58.000 | pass | `[2,58000]` |
| C.mcp.activity | agent_activity recorded the confirmed writes | pass | `25` |
| C.rest.sales | REST sales report totals = MCP | pass | `true` |
| C.rest.products | REST products report rows = MCP | pass | `true` |
| C.rest.dashboard | REST dashboard = MCP store_summary | pass | `true` |
| C.rest.pl | REST profit and loss = MCP profit_loss | pass | `true` |
| C.rest.shift | REST current shift expected cash = MCP | pass | `158000` |
| C.rest.receipt | the agent sale is in the owner sales list, seller Agent UMKMall | pass | `[49500,"agent"]` |
| C.mcp.crossTenant | store B's agent reads store C's product | pass | `true` |
| C.mcp.crossSale | store B's agent sells store C's product | pass | `true` |
