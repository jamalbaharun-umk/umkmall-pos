# QA test plan 01: payments and money

Scope: sale totals, unit/wholesale pricing, cash tender, payment-api orchestration, manual static QRIS, void and
refund, void PIN, kasbon (credit) payments, shift and drawer ledger, expenses, supplier payments, profit and loss,
agent (MCP) limits, and the tenancy / validation / logging rules that touch money.

Status on 2026-11-24: written against the owner-approved rules while the features are being built. What exists
today in `apps/pos-api`: `POST /sales`, `GET /sales`, `GET /sales/:id`, `GET /sales/:id/receipt`, `PUT /sales/settings`
(`taxBps`), `POST /shifts/open`, `POST /shifts/current/close`, `GET /shifts/current`, `GET /receivables`,
`POST /receivables/:id/payments`, `/payment-methods`, `/vouchers`, `/reports/*`. Everything else is marked
**(assumed endpoint)**: test the behaviour, adjust the name when the endpoint lands.

## Conventions

- **Type:** `[auto-api]` = e2e spec in `apps/pos-api/test/` (supertest, own `PGTEST_DB`); `[auto-ui]` = browser test
  on `apps/pos-web`; `[manual]` = a person at the till.
- **Priority:** P0 = money or stock is wrong, or a guard is bypassed; P1 = wrong but recoverable or visible;
  P2 = edge, wording, hardening.
- **Tags:** **[OPEN DECISION]** = the owner has not decided, the case records both outcomes; **[GAP]** = the rules do
  not say, the expected result is my assumption and needs confirmation before automation.
- All amounts are integer rupiah. `Rp130.536` means the integer `130536`.
- Every write that changes money or state sends `Idempotency-Key` (8 to 100 chars of `[A-Za-z0-9_-]`).
- **Tax rounding** is not in the owner rules. The current code (`taxOf` in `sales.service.ts`) rounds **half up** to a
  whole rupiah: `tax = floor((taxable × bps + 5000) / 10000)`. Voucher percentages round half up as well. All
  expected numbers below use that rule; cases that land exactly on a half are tagged.
- **Shifts are one open shift per actor** today. "The currently open shift" below means the open shift of the
  actor who starts the action (see gap G-07).

### Standard fixture (store A, "Toko Sumber Rejeki", timezone Asia/Jakarta, tax 0% unless a case says 11%)

| Key | Product | Price | Cost per base unit | Notes |
| --- | --- | --- | --- | --- |
| P1 | Indomie Goreng | Rp3.500 / pcs | Rp2.800 | 1 dus = 24 pcs at Rp78.000; tiers per pcs: qty ≥ 12 → Rp3.300, qty ≥ 48 → Rp3.200; stock kept in pcs |
| P2 | Es Teh Manis | Rp5.000 | Rp2.000 | |
| P3 | Beras 5 kg | Rp68.500 | Rp61.000 | |
| P4 | Permen | Rp333 | Rp200 | odd amounts |
| P5 | Kopi Sachet | Rp1.500 | Rp1.100 | |
| P6 | Es Jeruk | Rp5.000 | Rp2.500 | same price as P2, for tie cases |

Payment methods: Tunai (cash), Debit EDC, QRIS Toko (store static QRIS), Transfer, Kasbon (credit).
Members: Bu Sari, Pak Joko. Voucher `HEMAT10`: 10%, quota 5, no minimum.

| Actor | Permissions | Void PIN |
| --- | --- | --- |
| Owner | all | see gap G-05 |
| Admin Rina | `sales.create`, `sales.void`, `receivables.manage`, `expenses.manage` | `482913` |
| Admin Dedi | `sales.create`, `sales.void` | `715064` |
| Admin Tono | `sales.create`, `sales.void` | none set |
| Cashier Ayu | `sales.create`, `receivables.manage` | none |
| Cashier Budi | `sales.create` | none |
| Supervisor Wati | `sales.create`, `sales.price_override` | none |

Store B ("Warung Berkah") has its own products, staff, shift and an admin with a PIN, for cross-tenant cases.

---

## A. Sale totals, tax and discounts

**Money invariants**

- `total = subtotal − discount − voucherDiscount + tax`; `tax = round_half_up((subtotal − discount − voucherDiscount) × taxBps / 10000)`.
- Tax is computed once, on the amount after every discount. Never per line before discount.
- A discount is split over lines in whole rupiah; the line shares sum exactly to the discount; the split is the same on every replay.
- Every stored amount is an integer; no response field has a decimal point.
- The server computes price, discount, tax and total. Client-sent totals do not exist in the API; a client-sent price or discount counts only with `sales.price_override`.

### PAY-001 Plain cash sale, tax 0
`[auto-api]` P0
- **Pre:** Ayu has an open shift (float Rp100.000). P2 stock 50.
- **Steps:** `POST /sales` 3 × P2, `paid: 20000`, method Tunai.
- **Expected:** subtotal 3 × 5.000 = **15.000**; tax 0; total **15.000**; change 20.000 − 15.000 = **5.000**; `costTotal` 3 × 2.000 = **6.000**; stock 47; sale carries Ayu's `shiftId`.

### PAY-002 Tax 11% on the design example
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. P1 stock ≥ 36 pcs.
- **Steps:** Sell 12 pcs P1 + 1 dus P1, Tunai, `paid: 130536`.
- **Expected:** 12 × 3.300 = 39.600; 1 dus = 78.000; subtotal **117.600**; tax 117.600 × 11% = **12.936** (exact); total 117.600 + 12.936 = **130.536**; change 0.

### PAY-003 Tax is computed after a manual discount
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. Wati (price override) has an open shift.
- **Steps:** Wati sells 3 × P2 with `discount: 1500`.
- **Expected:** subtotal 15.000; taxable 15.000 − 1.500 = 13.500; tax 13.500 × 11% = **1.485**; total 13.500 + 1.485 = **14.985**. The wrong answer (tax before discount) would be tax 1.650, total 15.150: the test asserts it is not that.

### PAY-004 Tax after manual discount and voucher together
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. Voucher `HEMAT10` quota 5. Wati's shift open.
- **Steps:** Wati sells 1 × P3 + 2 × P2, `discount: 3500`, `voucherCode: HEMAT10`.
- **Expected:** subtotal 68.500 + 10.000 = 78.500; after manual discount 75.000; voucher 10% × 75.000 = **7.500**; taxable 67.500; tax 67.500 × 11% = **7.425**; total **74.925**; voucher quota 5 → 4.

### PAY-005 Tax rounding on odd amounts
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. One product per row priced as listed (create ad hoc products).
- **Steps:** Sell one unit at each price; read `tax` and `total`.
- **Expected:**

| Taxable | Exact 11% | Tax | Total |
| --- | --- | --- | --- |
| Rp1 | 0,11 | 0 | 1 |
| Rp4 | 0,44 | 0 | 4 |
| Rp5 | 0,55 | 1 | 6 |
| Rp333 | 36,63 | 37 | 370 |
| Rp4.545 | 499,95 | 500 | 5.045 |
| Rp9.999 | 1.099,89 | 1.100 | 11.099 |

### PAY-006 Tax exactly on a half rupiah **[GAP: rounding mode]**
`[auto-api]` P1
- **Pre:** `taxBps: 1100`. A product priced Rp50.
- **Steps:** Sell one.
- **Expected:** exact tax 5,5. Under the current half-up rule tax = **6**, total **56**. If the owner picks another mode (half even, floor) this becomes 5 / 55. The rule must be written down; this case pins it.

### PAY-007 Percentage voucher rounding on an odd subtotal
`[auto-api]` P1
- **Pre:** `taxBps: 1100`. Voucher `LIMA15`: 15%.
- **Steps:** Sell 3 × P4 with the voucher.
- **Expected:** subtotal 3 × 333 = 999; voucher 149,85 → **150**; taxable 849; tax 93,39 → **93**; total 849 + 93 = **942**.

### PAY-008 Discount allocation with a rounding remainder **[GAP: allocation rule]**
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. Wati's shift open.
- **Steps:** Wati sells 3 × P4 (999), 1 × P2 (5.000), 1 × P1 (3.500) with `discount: 1000`. Read the per-line discount share (assumed field `lines[].discountShare`).
- **Expected:** subtotal 9.499. Exact shares: 999 × 1000 / 9499 = 105,17; 5000 × 1000 / 9499 = 526,37; 3500 × 1000 / 9499 = 368,46. Floors 105 + 526 + 368 = 999; the remaining Rp1 goes to the largest fraction (P1 line): shares **105 / 526 / 369**, sum **1.000**. Taxable 8.499; tax 934,89 → **935**; total **9.434**. Rule-independent asserts: shares are integers, each ≥ 0 and ≤ its line total, sum = 1.000. The largest-remainder rule itself is my assumption.

### PAY-009 Allocation tie and determinism
`[auto-api]` P1
- **Pre:** Tax 0. Wati's shift open.
- **Steps:** (a) Sell 1 × P2 + 1 × P6 (both 5.000) with `discount: 1`. (b) Send the same cart again with the lines in the opposite order and a new key. (c) Replay (a) with its own key.
- **Expected:** (a) fractions tie at 0,5 each; exactly one line gets Rp1 and the other Rp0; total **9.999**. (b) The same product gets the Rp1 as in (a) (the tie-break must not depend on request order; the existing request hash already sorts lines by product id). (c) The replay returns the identical split.

### PAY-010 Discount boundaries: 100%, above subtotal, without permission
`[auto-api]` P0
- **Pre:** `taxBps: 1100`.
- **Steps:** (a) Wati: 3 × P2, `discount: 15000`, `paid: 0`. (b) Wati: `discount: 15001`. (c) Ayu (no override): `discount: 15000`, `paid: 16650`.
- **Expected:** (a) taxable 0, tax 0, total **0**, change 0, stock still drawn, cost 6.000 stored. (b) 422 on `discount`. (c) discount ignored: total 15.000 + 1.650 = **16.650**, `overrideBy` null.

### PAY-011 Maximum amounts stay exact
`[auto-api]` P1
- **Pre:** A service product priced Rp10.000.000 and one priced Rp10.000.001. Wati's shift.
- **Steps:** (a) Tax 0: sell qty 100.000 of the first, `paid: 1000000000000`. (b) Sell qty 100.000 of the second. (c) Tax 11%, repeat (a).
- **Expected:** (a) subtotal 100.000 × 10.000.000 = **1.000.000.000.000**, accepted, total equals subtotal, no precision loss in JSON. (b) subtotal 1.000.000.100.000 → 422 ("Total terlalu besar"), never 500. (c) tax = **110.000.000.000**, total **1.110.000.000.000**, but `paid` is capped at 1.000.000.000.000 by the schema, so the sale cannot be paid in cash: expect a clean 422, and see gap G-19.

### PAY-012 No float ever reaches storage or the wire
`[auto-api]` P1
- **Pre:** None.
- **Steps:** Send `paid: 20000.5`, `paid: "20000"`, `qty: 1.5`, `discount: 0.1`, `price: 3300.0001` (each in its own request). Then scan every sale, payment, shift, expense and report response of this plan's suites for a non-integer number.
- **Expected:** each bad request → 422 naming the field. No response contains a number with a fraction. DB columns for money are integer types (schema check).

---

## B. Unit and wholesale pricing

**Money invariants**

- Stock is stored and drawn in the base unit: 1 dus draws 24 pcs.
- The price of a line is chosen by the server from unit and quantity: pcs qty < 12 → 3.500; 12 ≤ qty < 48 → 3.300; qty ≥ 48 → 3.200; dus → 78.000 per dus.
- A client-sent price is ignored unless the actor holds `sales.price_override`.
- Each line stores the cost per pcs at the time of sale; later cost changes never alter it.

### PAY-013 Tier boundaries for pcs
`[auto-api]` P0
- **Pre:** Tax 0. P1 stock 200 pcs.
- **Steps:** Sell, in separate sales, 1, 11, 12, 47 and 48 pcs.
- **Expected:**

| Qty | Unit price | Line total | Line cost (2.800/pcs) |
| --- | --- | --- | --- |
| 1 | 3.500 | 3.500 | 2.800 |
| 11 | 3.500 | 38.500 | 30.800 |
| 12 | 3.300 | 39.600 | 33.600 |
| 47 | 3.300 | 155.100 | 131.600 |
| 48 | 3.200 | 153.600 | 134.400 |

Stock after all five: 200 − 119 = **81**. Note 48 pcs (153.600) costs less than 47 pcs (155.100): correct by the tier table, see G-13.

### PAY-014 Dus unit: price and base-unit stock
`[auto-api]` P0
- **Pre:** Tax 0. P1 stock 100 pcs.
- **Steps:** Sell 1 dus. Then sell 2 dus.
- **Expected:** 1 dus = **78.000**, stock 100 → 76, line cost 24 × 2.800 = **67.200**. 2 dus = **156.000**, stock 76 → 28, cost **134.400**.

### PAY-015 Mixed pcs and dus on one receipt, with tax (design example, full check)
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. P1 stock 100 pcs.
- **Steps:** One sale: 12 pcs + 1 dus of P1, Tunai, `paid: 150000`.
- **Expected:** subtotal **117.600**; tax **12.936**; total **130.536**; change 150.000 − 130.536 = **19.464**; stock 100 − 36 = **64**; cost 36 × 2.800 = **100.800**. The same product on two lines (two units) must be accepted; today's schema refuses a repeated `productId` (gap G-12).

### PAY-016 Wholesale price with a voucher and tax
`[auto-api]` P1
- **Pre:** `taxBps: 1100`. `HEMAT10`.
- **Steps:** Sale of PAY-015 with `voucherCode: HEMAT10`.
- **Expected:** voucher 10% × 117.600 = **11.760**; taxable 105.840; tax 11.642,4 → **11.642**; total 105.840 + 11.642 = **117.482**.

### PAY-017 Client-sent price is ignored without the permission
`[auto-api]` P0
- **Pre:** Tax 0. Ayu's shift.
- **Steps:** Ayu sells 12 pcs P1 with `price: 1000`, and 1 dus with `price: 1`.
- **Expected:** lines priced 3.300 and 78.000; subtotal **117.600**; `priceOverriddenBy` null on both; no error (the field is ignored, per current behaviour).

### PAY-018 Price override with the permission keeps the stored cost
`[auto-api]` P0
- **Pre:** Tax 0. Wati's shift.
- **Steps:** Wati sells 12 pcs P1 with `price: 3000`.
- **Expected:** line total 12 × 3.000 = **36.000**; `listPrice` 3.300 kept; `priceOverriddenBy` = Wati; line cost still 12 × 2.800 = **33.600**; gross profit on the line 2.400.

### PAY-019 Stock check in base units
`[auto-api]` P0
- **Pre:** Tax 0. P1 stock exactly 35 pcs.
- **Steps:** (a) Sell 12 pcs + 1 dus. (b) Sell 1 dus + 11 pcs. (c) With stock 23: sell 1 dus.
- **Expected:** (a) needs 36 > 35 → 422 naming the product and the remaining 35; no stock drawn, no sale, no receipt number used by a visible sale. (b) needs 35 → accepted: 78.000 + 11 × 3.500 = 38.500 → **116.500**; stock 0. (c) 422, remaining 23.

### PAY-020 Last stock unit raced by two cashiers
`[auto-api]` P0
- **Pre:** P1 stock exactly 24 pcs. Ayu and Budi each have an open shift.
- **Steps:** At the same moment Ayu sells 1 dus and Budi sells 1 pcs (different keys). Repeat 20 times with a fresh stock of 24.
- **Expected:** every run ends in one of two states: dus sold, pcs refused (stock 0, revenue 78.000), or pcs sold, dus refused (stock 23, revenue 3.500). Never both, never negative stock, the loser gets 422 (not 500, no deadlock error).

### PAY-021 Stored line cost survives a later cost change
`[auto-api]` P0
- **Pre:** Sale of 12 pcs P1 done at cost 2.800 (line cost 33.600).
- **Steps:** Receive a new batch at Rp3.000 / pcs and set the product cost to 3.000. Read the old sale and the profit report.
- **Expected:** old line cost still **33.600**; report COGS for that sale 33.600, not 12 × 3.000 = 36.000.

### PAY-022 Tier and unit interplay **[GAP]**
`[manual]` P1
- **Pre:** Tax 0.
- **Steps:** Price these carts and record what the POS does: (a) 6 pcs + 1 dus (30 pcs in total); (b) 24 pcs entered as pcs; (c) 2 dus versus 48 pcs.
- **Expected (assumed: the tier looks only at the pcs line; units are never converted automatically):** (a) 6 × 3.500 + 78.000 = **99.000**; (b) 24 × 3.300 = **79.200** (Rp1.200 more than 1 dus at 78.000); (c) 2 dus = **156.000**, 48 pcs = **153.600** (the loose pcs are Rp2.400 cheaper than two cartons). Whether (b) should suggest a dus and whether (c) is intended needs an owner answer (G-13).

---

## C. Cash tender and change

**Money invariants**

- `change = tendered − total`, never negative. Tendered below total is rejected.
- The drawer gains `tendered − change` = the sale total, whatever was tendered.
- Non-cash methods must be paid exactly the total.

### PAY-023 Change on the design example
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. Total Rp130.536 (PAY-002 cart).
- **Steps:** Pay Tunai with `paid: 150000`.
- **Expected:** change 150.000 − 130.536 = **19.464**; shift expected cash rises by **130.536**, not 150.000.

### PAY-024 "Exact" quick button
`[auto-ui]` P1
- **Pre:** Cart total Rp130.536 on the cashier screen.
- **Steps:** Press the exact-amount button ("Uang pas"), then pay.
- **Expected:** the tendered field shows 130.536; change shows Rp0; the request carries `paid: 130536`; the receipt prints change 0.

### PAY-025 Tendered below total
`[auto-api]` P0
- **Pre:** Total Rp130.536.
- **Steps:** `paid: 130535`; then `paid: 0`.
- **Expected:** both 422 on `paid` with the total in the message; no sale, no stock change, no drawer change.

### PAY-026 Non-cash must equal the total
`[auto-api]` P1
- **Pre:** Total Rp130.536, method Debit EDC.
- **Steps:** `paid: 130537`; `paid: 130535`; `paid: 130536`.
- **Expected:** 422, 422, accepted with change 0 and no drawer change.

### PAY-027 Change rounding **[OPEN DECISION]**
`[manual]` P1
- **Pre:** Total Rp130.536, tendered Rp150.000 (exact change 19.464; no coin below Rp100 circulates in practice).
- **Steps:** Complete the sale; note the change shown, the change on the receipt and the drawer movement.
- **Expected today (no rounding):** change **19.464**, drawer +130.536. **If rounding to Rp100 is chosen:** change 19.500 (drawer +130.500, store loses Rp36) or 19.400 (drawer +130.600, store keeps Rp64). The decision must also say where that Rp36 / Rp64 is booked (a rounding line in the shift and P&L), or expected cash will never reconcile.

### PAY-028 Tender boundaries and the UI quick amounts
`[auto-ui]` P2
- **Pre:** Total Rp15.000.
- **Steps:** Type 15.000, 20.000, 100.000 via quick buttons; type letters, a minus sign, `15.000,50`; type a 14-digit number.
- **Expected:** change 0 / 5.000 / 85.000; non-digits are refused by the field; the pay button stays disabled while tendered < total; the 14-digit amount shows an Indonesian validation message, and the API answers 422 if forced (`paid` > 1.000.000.000.000).

---

## D. payment-api orchestration, manual static QRIS, refund contract

**Money invariants**

- payment-api is the source of truth for payment status. A sale is `completed` only when its payment is `paid`.
- One sale ↔ one payment ↔ one method. No split payment.
- pos-api sends the server-computed total and an idempotency key derived from the sale; a retry reuses it; payment-api never charges twice for one key.
- A failed payment leaves no payment, no stock change, no voucher use, no drawer change, no receivable.
- Shift and drawer ledger live in pos-api; payment-api knows nothing about drawers.
- CASHAC (cash, EDC debit, static QRIS, kasbon) is cancelled by void with no PG call. Online PG payments (dynamic QRIS, VA) are cancelled by refund through payment-api. PG itself is M5 and legal-locked: stub only.

### PAY-029 Cash sale: pending → charge → paid → completed
`[auto-api]` P0
- **Pre:** payment-api stub healthy. Ayu's shift open. Tax 0.
- **Steps:** `POST /sales` 3 × P2, Tunai, `paid: 20000`. Inspect the calls received by the stub (`POST /charges`, assumed endpoint).
- **Expected:** exactly one charge: amount **15.000**, method class CASHAC/cash, an idempotency key, the tenant reference; no PG call. Sale ends `completed`; payment `paid`; stock 47; drawer +15.000.

### PAY-030 The amount sent to payment-api is the server total
`[auto-api]` P0
- **Pre:** Ayu (no override).
- **Steps:** Send a sale with `price: 1` on the line and any extra `total` / `amount` field.
- **Expected:** the extra field is refused (strict schema, 422) or, for `price`, ignored; the charge carries the catalog total; nothing from the client reaches the charge amount.

### PAY-031 payment-api answers "failed"
`[auto-api]` P0
- **Pre:** Stub returns `failed` for the next charge. P2 stock 50, `HEMAT10` quota 5.
- **Steps:** Sell 3 × P2 with the voucher.
- **Expected:** the client gets a clear failure (Indonesian message, no gateway internals). No completed sale, no payment row, stock **50**, quota **5**, drawer unchanged, no receivable. Whether a failed attempt uses a receipt number is gap G-18.

### PAY-032 Timeout, then retry with the same key
`[auto-api]` P0
- **Pre:** Stub delays the first charge past the pos-api timeout, then records it `paid`.
- **Steps:** `POST /sales` (key K1) → times out. Retry with K1 twice.
- **Expected:** the stub saw one logical charge (same payment idempotency key on every attempt). pos-api returns the same sale id each time, finally `completed`. Stock drawn once (50 → 47), drawer +15.000 once.

### PAY-033 Uncertain result resolves through history, without a duplicate
`[auto-ui]` P0
- **Pre:** As PAY-032, on the cashier screen.
- **Steps:** Press pay; the request times out. Observe the screen. Open the sales history.
- **Expected:** the pay button is locked while the request is in flight; after the timeout the screen says the status is not known yet and points to history; history shows one sale (`pending`, then `completed`); pressing pay again on the same cart reuses the same key and creates nothing new.

### PAY-034 Reconciliation job completes a hanging paid sale
`[auto-api]` P0
- **Pre:** A sale left `pending` in pos-api while payment-api holds the payment as `paid` (simulate a crash after the charge).
- **Steps:** Run the reconciliation job. Run it a second time.
- **Expected:** first run: sale `completed`, stock, voucher and drawer applied exactly once. Second run: no change (idempotent).

### PAY-035 Reconciliation job cancels a hanging unpaid sale
`[auto-api]` P0
- **Pre:** A sale `pending` whose payment is `failed` or was never created, older than the job threshold.
- **Steps:** Run the job.
- **Expected:** sale ends `failed`/cancelled; no stock, voucher, drawer or receivable effect remains; it is not counted in revenue, COGS, shift totals or sales count.

### PAY-036 payment-api unavailable for a cash sale **[GAP]**
`[auto-api]` P1
- **Pre:** Stub answers 503 / connection refused.
- **Steps:** Sell 3 × P2 in cash.
- **Expected (assumed):** a 503-class answer with a clear message, sale left `pending` for reconciliation or not created at all, never `completed`, never 500 with a stack. Whether a cash sale may complete while payment-api is down (the till cannot sell during an outage otherwise) is not decided (G-17).

### PAY-037 Manual static QRIS: happy path
`[auto-ui]` P0
- **Pre:** Store QRIS configured (QR image and merchant name). Ayu's shift. Tax 11%, cart = design example.
- **Steps:** Choose QRIS Toko. Check the screen. Press "Diterima" (received).
- **Expected:** the screen shows the store QR and the amount **Rp130.536**; before the press the sale is `pending` and absent from revenue; after it the sale is `completed`, the payment records who confirmed (Ayu) and when; drawer cash unchanged; shift report lists it under QRIS.

### PAY-038 Static QRIS not configured
`[auto-api]` P0
- **Pre:** No store QRIS set.
- **Steps:** Create a sale with method QRIS Toko.
- **Expected:** 422 with a clear message (for example "QRIS toko belum diatur"); no sale, no stock change. In the UI the method is shown disabled with the same reason.

### PAY-039 Static QRIS: "received" pressed twice, and by two devices
`[auto-api]` P0
- **Pre:** A pending static-QRIS sale of Rp130.536.
- **Steps:** Send the confirm call (`POST /sales/:id/payment/confirm`, assumed endpoint) twice with the same key; then from a second device with a new key.
- **Expected:** one payment, one stock draw; the second and third calls return the completed sale (or 409 for the new key) without a second effect; `confirmedBy` stays the first actor.

### PAY-040 Static QRIS: pending and failed states on screen
`[auto-ui]` P1
- **Pre:** Stub: first confirm → `pending` for 5 s, then `failed`.
- **Steps:** Press "Diterima"; watch; press again after the failure.
- **Expected:** button locked while pending; on failure an error state with a retry; the retry reuses the same idempotency key; after the failure there is no payment and stock is unchanged; a later success completes the sale once.

### PAY-041 A pending sale is abandoned (customer walks away)
`[auto-api]` P1
- **Pre:** A pending static-QRIS sale; "received" never pressed.
- **Steps:** Cancel it from the screen (assumed endpoint `POST /sales/:id/cancel`), or let reconciliation expire it. Then try to close the shift while another sale is still pending.
- **Expected:** cancelled sale: no stock, no revenue, no drawer effect, no PIN needed (it was never paid, so it is not a void). Closing a shift with a pending sale is gap G-16: assumed blocked with a message naming the pending receipt.

### PAY-042 Online PG contract: charge and webhook (stub only, M5 legal-locked)
`[auto-api]` P1
- **Pre:** payment-api with the PG stub; a dynamic-QRIS method enabled for the test tenant only.
- **Steps:** Create a sale of Rp43.956; stub PG sends "paid" webhook once, then the same webhook again; in another run it sends an amount of Rp43.955.
- **Expected:** sale `pending` until the webhook; completed once; duplicate webhook has no effect; amount mismatch does not complete the sale and is flagged. No real PG host is contacted (assert on the stub).

### PAY-043 Refund versus void routing
`[auto-api]` P0
- **Pre:** Sale X paid by cash; sale Y paid by dynamic QRIS (stub).
- **Steps:** (a) Refund X (`POST /sales/:id/refund`, assumed endpoint). (b) Void Y (`POST /sales/:id/void`, assumed endpoint). (c) Refund Y fully, twice with the same key. (d) Refund Y with `amount: 10000`.
- **Expected:** (a) 422: cash receipts are voided, not refunded. (b) 422: online payments are refunded. (c) payment-api calls the PG stub exactly once; sale reversed once; stock and voucher restored once; the drawer does not change. (d) 422: no partial refund.

### PAY-044 One method per receipt
`[auto-api]` P1
- **Pre:** None.
- **Steps:** Send `paymentMethodId` as an array; send a `payments: [{...},{...}]` field; send two method ids.
- **Expected:** 422 (strict schema). No API path records two methods on one sale. Kasbon with a cash down payment is the one existing exception and contradicts this rule (G-01).

### PAY-045 Payment status is tenant-scoped
`[auto-api]` P0
- **Pre:** Store A sale with a payment; store B session.
- **Steps:** Store B reads the sale's payment (`GET /sales/:id/payment`, assumed endpoint), confirms it, refunds it.
- **Expected:** 404 for each; payment-api is asked with store B's tenant and returns nothing of A's; A's payment unchanged.

---

## E. Void: core behaviour

**Money invariants**

- Void is the full receipt or nothing. No partial void.
- Void never edits or deletes the sale, its lines, or any closed shift: it appends a reversal.
- Stock, voucher quota, receivable and drawer change in one transaction: all or none.
- Reversed COGS = the cost stored on the sale lines, never the current cost.
- Money returned = what the customer actually paid on that receipt (the sale total for a paid sale; the instalments for a kasbon).
- A receipt is voided at most once, under any concurrency.

All void cases use `POST /sales/:id/void` **(assumed endpoint)** with `Idempotency-Key`, body `{ reason, approverId, pin }`, started by a cashier and approved by Admin Rina (PIN `482913`) unless stated.

### PAY-046 Void a cash sale in the same shift
`[auto-api]` P0
- **Pre:** Ayu's shift, float Rp100.000. Sale S1: 3 × P2 = 15.000 cash (stock 50 → 47).
- **Steps:** Void S1, reason "Salah input barang".
- **Expected:** S1 marked voided; a reversal record of **−15.000** revenue and **−6.000** COGS; stock back to **50**; shift expected cash = 100.000 + 15.000 − 15.000 = **100.000**, shown as "cash sales 15.000" and "returned by void 15.000" (not as cash sales 0); S1's own rows unchanged (compare a snapshot of `sales` and `sale_lines` before and after, ignoring a status/void pointer if one exists).

### PAY-047 Void a sale with tax, manual discount and voucher
`[auto-api]` P0
- **Pre:** Sale of PAY-004: total 74.925, voucher quota 5 → 4, paid cash 80.000 (change 5.075).
- **Steps:** Void it.
- **Expected:** cash returned **74.925** (the total, not the 80.000 tendered); voucher quota back to **5**; reversal: subtotal −78.500, discount −3.500, voucher −7.500, tax −7.425, total −74.925; stock P3 +1, P2 +2.

### PAY-048 Void uses the stored line cost, not the current cost
`[auto-api]` P0
- **Pre:** Sale of 3 × P2 at cost 2.000 (COGS 6.000). Afterwards a new batch arrives at Rp2.500 and the product cost is set to 2.500.
- **Steps:** Void the sale. Read stock valuation and the profit report.
- **Expected:** COGS reversal **−6.000** (not −7.500); the 3 units return to stock valued at 2.000 each; profit for the voided sale nets to exactly 0.

### PAY-049 Void a sale whose stock came from two FIFO batches
`[auto-api]` P1
- **Pre:** P2 batches: 2 units at 2.000, then 10 units at 2.400. Sale of 5 × P2: cost 2 × 2.000 + 3 × 2.400 = **11.200**.
- **Steps:** Void.
- **Expected:** COGS reversal exactly **−11.200**; 5 units back on hand; inventory value rises by 11.200 (not 5 × 2.400 = 12.000 and not 5 × 2.000 = 10.000). Note: line cost per pcs is 2.240 here, a whole number by luck; a stored "cost per pcs" cannot hold 11.200 / 5 in general (G-14).

### PAY-050 Partial void is impossible
`[auto-api]` P0
- **Pre:** A sale with two lines.
- **Steps:** Send the void with `lines: [...]`, with `amount: 5000`, with `qty`.
- **Expected:** 422 each (strict schema). No endpoint voids a line or an amount.

### PAY-051 Reason is required
`[auto-api]` P0
- **Pre:** A voidable sale.
- **Steps:** Void with no `reason`, with `""`, with `"   "`, with a 2.000-character reason.
- **Expected:** 422 on `reason` each time; the PIN attempt counter does not move (validation runs before the PIN check, see G-06); nothing voided.

### PAY-052 Idempotent retry of a void
`[auto-api]` P0
- **Pre:** Sale S1 15.000 cash.
- **Steps:** Void with key V1. Send the identical request with V1 again (network replay). Send V1 with a different sale id.
- **Expected:** one reversal, one cash-out of 15.000, stock +3 once; the replay returns the first result; the key reused on another sale is refused with 422. A missing or malformed `Idempotency-Key` → 422.

### PAY-053 A second void of the same receipt
`[auto-api]` P0
- **Pre:** S1 already voided.
- **Steps:** Void S1 again with a new key and a correct PIN.
- **Expected:** refused (409 or 422, "Struk sudah dibatalkan"); no second reversal; drawer and stock unchanged.

### PAY-054 Two cashiers void the same receipt at the same time
`[auto-api]` P0
- **Pre:** S1 15.000 cash, stock 47. Ayu and Budi both have open shifts; Rina approves on Ayu's device, Dedi on Budi's.
- **Steps:** Fire both voids in parallel with different keys. Repeat 20 times.
- **Expected:** exactly one succeeds each time; stock is 50 (not 53); one cash-out of 15.000 in exactly one shift; the loser gets the "already voided" answer, not 500; history shows one starter and one approver.

### PAY-055 Atomicity: a failure midway leaves nothing behind
`[auto-api]` P0
- **Pre:** Sale with voucher, stock and cash. Force the drawer-ledger insert (or the stock restore) to fail (test hook or constraint).
- **Steps:** Void.
- **Expected:** error answer without internals; sale not voided; stock, voucher quota, drawer, receivable all unchanged; a retry after the fault is removed succeeds once.

### PAY-056 Void of a store-QRIS receipt **[OPEN DECISION]**
`[auto-api]` P0
- **Pre:** Ayu's shift, float Rp100.000, no cash sales. Sale by QRIS Toko of Rp130.536 (drawer unchanged at 100.000).
- **Steps:** Void it.
- **Expected per current design:** cash-out of **130.536** from the drawer: expected cash 100.000 − 130.536 = **−30.536**. The system must handle the negative value without error and the screen should warn that the drawer does not hold that much (G-08). **If the owner decides "bank transfer back":** drawer stays **100.000** and the void records a non-drawer return. Automate after the decision; until then assert only stock, revenue and the single reversal.

### PAY-057 Void of a transfer receipt **[OPEN DECISION]**
`[auto-api]` P1
- **Pre:** Float Rp100.000, one cash sale of 15.000 (expected 115.000). Sale by Transfer of Rp68.500.
- **Steps:** Void the transfer sale.
- **Expected per current design:** expected cash 115.000 − 68.500 = **46.500**. Alternative: stays **115.000**. Same decision as PAY-056.

### PAY-058 Void of an EDC debit receipt **[GAP]**
`[manual]` P1
- **Pre:** Sale by Debit EDC of Rp137.000.
- **Steps:** Void it; follow where the system says the money goes back.
- **Expected:** not stated in the rules (they name cash, transfer and store QRIS). Assumed to follow PAY-056/057 (cash-out of **137.000** from the drawer). Confirm, because an EDC reversal on the machine is the other obvious path.

### PAY-059 Void is refused for states that are not a paid CASHAC receipt
`[auto-api]` P1
- **Pre:** One sale each: `pending`, `failed`, paid by dynamic QRIS (stub), already refunded.
- **Steps:** Void each with a correct PIN.
- **Expected:** 422 with the reason for each; no PIN attempt is consumed for a state error (G-06); nothing changes.

### PAY-060 Void when the catalog changed since the sale
`[auto-api]` P2
- **Pre:** Sale with `HEMAT10` and 3 × P2. Afterwards P2 is soft-deleted, the voucher is deleted (or expired), the payment method is soft-deleted.
- **Steps:** Void.
- **Expected (assumed):** void succeeds; the 3 units return to the deleted product's stock ledger (so valuation stays right); the voucher row's quota is restored even though it can no longer be used; cash returned = total. Confirm the deleted-voucher behaviour (G-20).

### PAY-061 Void of a price-overridden sale
`[auto-api]` P1
- **Pre:** PAY-018 sale: 12 pcs at the overridden 3.000 = 36.000, cost 33.600.
- **Steps:** Void.
- **Expected:** cash returned **36.000** (what was paid), not 39.600 (list); COGS reversal **−33.600**; stock +12 pcs.

### PAY-062 Void of a unit sale restores base units
`[auto-api]` P1
- **Pre:** `taxBps: 1100`. Design-example sale (12 pcs + 1 dus, total 130.536), stock 100 → 64.
- **Steps:** Void.
- **Expected:** stock back to **100** pcs (+36); returned **130.536**; tax reversal **−12.936**; COGS reversal **−100.800**.

---

## F. Void: permission, PIN and lockout

**Invariants**

- A void needs an approver who holds `sales.void` and has a 6-digit void PIN. The cashier starts; the admin enters the PIN on the same device.
- The PIN is stored hashed, and is never returned, displayed, logged, written to history, or passed through the agent.
- 5 wrong PINs for one admin lock that admin's approvals for 5 minutes (300 s). A correct PIN during the lock is still refused. A success resets the counter. Counters are per admin. The owner can unlock.
- History records who started and who approved.

Endpoints here are assumed: `PUT /staff/:id/void-pin`, `POST /staff/:id/void-pin/unlock`.

### PAY-063 Starter × approver permission matrix
`[auto-api]` P0
- **Pre:** Sale S 15.000 cash in an open shift; a fresh copy of S for every row.
- **Steps:** Run each row.
- **Expected:**

| # | Started by | Approver, PIN entered | Result |
| --- | --- | --- | --- |
| 1 | Cashier Ayu (no `sales.void`) | Rina, correct | voided; history: started Ayu, approved Rina |
| 2 | Cashier Ayu | Budi (no `sales.void`), any PIN | refused, nothing voided |
| 3 | Cashier Ayu | Tono (`sales.void`, no PIN) | refused: "Admin ini belum membuat PIN" |
| 4 | Cashier Ayu | Rina, wrong PIN | refused, Rina's counter +1 |
| 5 | Cashier Ayu | none (`approverId`/`pin` missing) | 422 |
| 6 | Admin Rina herself | Rina, correct | **[GAP G-04]** assumed voided, started = approved = Rina |
| 7 | Admin Rina | Dedi, correct | voided; started Rina, approved Dedi |
| 8 | Owner | owner's own PIN, correct | **[GAP G-05]** assumed voided if the owner has set a void PIN |
| 9 | Owner | no PIN supplied | 422: the owner is not exempt from the PIN |
| 10 | Staff with no `sales.create` (reports only) | Rina, correct | **[GAP G-03]** assumed 403 for the starter |
| 11 | Cashier Ayu | Rina's id with Dedi's PIN | refused, Rina's counter +1, Dedi's unchanged |
| 12 | Cashier Ayu | deactivated admin with a PIN, correct | refused, same answer as a wrong PIN |

Row 1 depends on reading the rule as "the approver holds `sales.void`"; the rule text can also be read as "the starter needs it" (G-03).

### PAY-064 No void PIN exists anywhere in the store
`[auto-ui]` P0
- **Pre:** No staff member and no owner has a void PIN.
- **Steps:** Ayu opens the void dialog on a receipt.
- **Expected:** a clear message that no admin has a PIN yet and where to set one (staff settings); no PIN field that can never succeed; the API answers 422 with the same message, not 401 and not 500.

### PAY-065 Setting a void PIN: format
`[auto-api]` P1
- **Pre:** Owner session.
- **Steps:** Set Rina's PIN to `12345`, `1234567`, `12a456`, `" 482913"`, `482913`. Then a cashier without `staff.manage` tries to set Rina's PIN. Then Rina sets her own.
- **Expected:** the first four → 422; `482913` → accepted; the cashier → 403; own PIN → accepted (assumed). A staff member without `sales.void` cannot be given an approving PIN, or the PIN is inert (row 2 of PAY-063).

### PAY-066 The PIN never leaves the server
`[auto-api]` P0
- **Pre:** Rina and Dedi both set the PIN `482913` (same PIN on purpose).
- **Steps:** Read `GET /staff`, `GET /staff/:id`, the void response, void history, receipts. Read both hashes from the database.
- **Expected:** no response contains `482913`, `pin`, or a hash field; the two stored hashes differ (per-user salt, the existing scrypt helper); the hash column is not the raw PIN.

### PAY-067 Wrong PIN 1 to 4: refused, no lock
`[auto-api]` P0
- **Pre:** Rina's counter 0. A voidable sale.
- **Steps:** Four void attempts with wrong PINs (new key each).
- **Expected:** each refused with the same answer shape; no lock; nothing voided; the answer may state attempts left (4, 3, 2, 1) but never whether a digit was right.

### PAY-068 Correct PIN after 4 wrong resets the counter
`[auto-api]` P0
- **Pre:** State after PAY-067 (4 wrong).
- **Steps:** Void with the correct PIN. Then, on another sale, enter 4 wrong PINs again, then the correct one.
- **Expected:** first void succeeds; the next 4 wrong attempts do not lock (the counter restarted at 0, it did not continue 5, 6, 7, 8); the final correct PIN succeeds.

### PAY-069 The 5th wrong PIN locks for 5 minutes
`[auto-api]` P0
- **Pre:** Counter 0. Clock controllable (fake timers or an injected clock).
- **Steps:** Five wrong PINs in a row at t = 0:00.
- **Expected:** the 5th answer says the admin is locked, with `retryAfter` = **300** seconds; nothing voided.

### PAY-070 A correct PIN during the lock is still refused
`[auto-api]` P0
- **Pre:** Rina locked at t = 0:00.
- **Steps:** At t = 1:00 send the correct PIN. At t = 2:00 send a wrong PIN. Read `lockedUntil`.
- **Expected:** both refused with the locked answer (`retryAfter` 240, then 180); nothing voided; attempts during the lock do not extend it (`lockedUntil` stays t = 5:00). Whether attempts during a lock extend it is not in the rules (G-06); this is the assumption.

### PAY-071 Lock expiry boundary
`[auto-api]` P0
- **Pre:** Rina locked at t = 0:00.
- **Steps:** Correct PIN at t = 4:59; correct PIN at t = 5:00 (exactly `lockedUntil`).
- **Expected:** 4:59 refused (`retryAfter` 1); 5:00 accepted, the sale is voided, counter 0.

### PAY-072 After the lock expires, the count starts again **[GAP]**
`[auto-api]` P1
- **Pre:** Rina's lock just expired; no success since.
- **Steps:** One wrong PIN at t = 5:01. Then four more.
- **Expected (assumed):** the first wrong PIN after expiry counts as 1 and does not lock at once; the lock comes at the 5th again, again for 300 s (no escalation, unlike the cashier sign-in lock which doubles). Confirm (G-06).

### PAY-073 Counters are per admin, and per store
`[auto-api]` P0
- **Pre:** Rina locked. Dedi's counter 0. Store B's admin exists.
- **Steps:** (a) Void approved by Dedi with his correct PIN. (b) Three wrong PINs for Dedi. (c) From a store A session, send store B's admin id as `approverId` five times.
- **Expected:** (a) succeeds while Rina is locked. (b) Dedi's counter 3, Rina's lock untouched. (c) refused each time with the same answer as an unknown approver; store B's admin gets no failed attempts and no lock.

### PAY-074 The lock follows the admin across devices
`[auto-api]` P1
- **Pre:** Rina locked from device 1.
- **Steps:** Try her correct PIN on device 2 (another cashier's session).
- **Expected:** refused with the lock answer; the lock is on the admin, not on the device or the cashier.

### PAY-075 Parallel guesses cannot beat the counter
`[auto-api]` P0
- **Pre:** Rina's counter 0.
- **Steps:** Send 20 void requests in parallel: 19 wrong PINs and 1 correct.
- **Expected:** at most 5 PINs are evaluated before the lock (row lock on the attempt counter, as the sign-in flow does); the run never evaluates more than 5 wrong guesses; either the correct one landed among the first evaluated (one void) or the admin is locked. No request gets 500.

### PAY-076 Owner unlocks an admin
`[auto-api]` P0
- **Pre:** Rina locked at t = 0:00.
- **Steps:** At t = 1:00: Ayu calls unlock; Dedi (admin) calls unlock; Rina calls unlock on herself; the owner calls unlock. Then Rina approves a void.
- **Expected:** the first three → 403; the owner → success; Rina's counter 0 and lock cleared; her correct PIN works at t = 1:01; history records the unlock (who, when, for whom). Store B's owner unlocking Rina → 404.

### PAY-077 Malformed PIN input
`[auto-api]` P1
- **Pre:** Counter 0.
- **Steps:** Send `pin` as `12345`, `1234567`, `abcdef`, a number `482913`, `null`, a 10.000-character string.
- **Expected:** 422 each; the counter stays 0 (assumed: a value that cannot be a PIN is not a guess, G-06); the long string is rejected by length before any hashing.

### PAY-078 Wrong PIN, then the right PIN, same Idempotency-Key
`[auto-api]` P1
- **Pre:** Counter 0. Sale S.
- **Steps:** Void S with key V9 and a wrong PIN. Void S with V9 and the correct PIN. Replay V9 with a wrong PIN.
- **Expected:** first refused (counter 1) and the refusal is not stored as the key's result; second succeeds; the replay returns the first success without voiding again. The raw PIN is not part of any stored request fingerprint (G-06 lists what the replay should do with the PIN).

### PAY-079 PIN entry on the cashier's device
`[auto-ui]` P1
- **Pre:** Ayu signed in on the till; a receipt open.
- **Steps:** Start the void, choose Rina, type a reason, enter the PIN; use the browser's back button; reload mid-dialog; inspect the page's DOM, local storage and network log.
- **Expected:** the PIN field is masked, numeric, 6 digits, not auto-filled and not offered to the password manager; after the dialog closes the PIN is in no storage, URL or state dump; the session stays Ayu's (Rina is not signed in by approving); a reload clears the dialog without sending anything; the pay/void button is locked while the request runs.

### PAY-080 Lock message on screen
`[auto-ui]` P2
- **Pre:** Rina locked with 3:20 left.
- **Steps:** Open the void dialog and choose Rina.
- **Expected:** Indonesian message with the remaining time (counting down or stated once), a hint that another admin can approve or the owner can unlock; the PIN field disabled for Rina only.

---

## G. Void against a closed shift, and across the day boundary

**Money invariants**

- A closed shift row and everything summed into it never changes: `expectedCash`, `cashSales`, `salesCount`, `countedCash`, `closedAt`.
- The money returned for an old receipt is a cash-out in the currently open shift.
- No open shift → the void is blocked with a clear error and nothing changes.

### PAY-081 Void yesterday's cash receipt
`[auto-api]` P0
- **Pre:** Shift S1 (Ayu, 23 Nov): float 100.000, one cash sale #1 of 15.000, closed with counted 115.000 (expected 115.000, difference 0). 24 Nov: Ayu opens S2 with float 100.000.
- **Steps:** Void sale #1 (approved by Rina).
- **Expected:** S1 row identical before and after: expected **115.000**, cash sales 15.000, sales count 1, counted 115.000, difference 0, same `closedAt`. S2: "returned by void" **15.000**, expected 100.000 − 15.000 = **85.000**. Stock +3. The reversal row carries S2's id as the shift where the cash left.

### PAY-082 Void with no open shift is blocked
`[auto-api]` P0
- **Pre:** As PAY-081 but nobody has an open shift.
- **Steps:** Void sale #1 with a correct PIN.
- **Expected:** 422 with a clear message ("Buka shift dulu untuk membatalkan struk"); nothing voided; stock, voucher, reports unchanged; Rina's PIN counter unchanged; no shift is opened implicitly.

### PAY-083 Whose open shift pays out **[GAP]**
`[auto-api]` P1
- **Pre:** Sale #1 was made in Ayu's shift S-A, which is still open with expected 115.000. Budi has his own open shift S-B (float 100.000). Budi starts the void on his till.
- **Steps:** Void, approved by Rina.
- **Expected (assumed: the starter's open shift):** S-B expected 100.000 − 15.000 = **85.000**; S-A stays **115.000** (it keeps the sale's cash). The other reading (the sale's own shift when it is still open) gives S-A 100.000 and S-B 100.000. The rule must name one (G-07). Also run: starter has no open shift but another cashier does → assumed blocked.

### PAY-084 Void after midnight, store in WITA
`[auto-api]` P0
- **Pre:** Store timezone Asia/Makassar (UTC+8). Budi's shift open since 16:00 WITA. Cash sale #25 of Rp68.500 (1 × P3) at 2026-11-23T15:40:00Z = 23:40 WITA on 23 Nov. Clock injected.
- **Steps:** Void at 2026-11-23T16:10:00Z = 00:10 WITA on 24 Nov. Read the sales report for 23 Nov, for 24 Nov, and for 23 to 24 Nov.
- **Expected (assumed: the reversal is dated at the void, G-09):** 23 Nov revenue **68.500**, COGS 61.000 (unchanged from before the void); 24 Nov revenue **−68.500**, COGS **−61.000**; range 23 to 24 Nov: revenue **0**, COGS **0**, profit **0**. The range result holds under either dating policy. In Asia/Jakarta both instants are 23 Nov (22:40 and 23:10): the same data must net to 0 inside 23 Nov when the store timezone is Jakarta.

### PAY-085 Void of an old receipt when the day's drawer is small **[GAP]**
`[manual]` P1
- **Pre:** Open shift with float Rp50.000 and no sales. A closed-shift cash receipt of Rp130.536.
- **Steps:** Void it.
- **Expected:** rules do not say. Assumed: allowed with a warning that the drawer holds less than the return (as the expense rule does), expected cash 50.000 − 130.536 = **−80.536**. Confirm warn versus block (G-08).

### PAY-086 A closed shift cannot be reached by any write
`[auto-api]` P0
- **Pre:** Closed shift S1 with sales, a kasbon payment and an expense.
- **Steps:** Try, by id: add an expense to S1, add a kasbon payment to S1, re-close S1 with another count, void one of its sales and inspect S1, delete one of its expenses (assumed endpoints). Then, as a DB check, compare a checksum of S1's row and of every ledger row with `shift_id = S1` before and after the whole suite.
- **Expected:** every direct write is refused (404/409/422); the checksum is unchanged after voids, payments and reports run against later shifts.

---

## H. Kasbon (credit) payments

**Money invariants**

- `remaining = sale total − Σ payments` (minus any cancellation), always derived from the ledger; a stored `rest` must equal it at all times.
- A payment is > 0 and ≤ remaining. Paying exactly the remaining settles it.
- Cash payments enter the currently open shift's drawer. Transfer and store-QRIS payments do not touch the drawer.
- A kasbon sale is revenue on the day of the sale and is not drawer cash. A kasbon payment is drawer cash (if cash) and is never revenue again.
- No open shift: cash payment blocked; Transfer and QRIS Toko allowed.
- Row lock plus `Idempotency-Key`: a double tap is one payment.

Base case for this group: Bu Sari buys 4 × P5 on Kasbon, tax 0: total 4 × 1.500 = **6.000**, paid 0, receivable R with remaining **6.000**.

### PAY-087 Kasbon sale: revenue yes, drawer no
`[auto-api]` P0
- **Pre:** Ayu's shift, float 100.000.
- **Steps:** Make the base sale. Read shift, sales report, receivable.
- **Expected:** shift expected cash still **100.000**; revenue **+6.000**, COGS +4.400 (4 × 1.100); receivable total 6.000, remaining 6.000; stock P5 −4. A kasbon sale without a member → 422.

### PAY-088 Partial cash payment (owner's example)
`[auto-api]` P0
- **Pre:** R remaining 6.000. Ayu's shift expected 100.000.
- **Steps:** `POST /receivables/:id/payments` `amount: 2500`, Tunai.
- **Expected:** remaining 6.000 − 2.500 = **3.500**; shift "kasbon payments (cash)" 2.500, expected **102.500**; revenue report unchanged at 6.000; the payment records actor, time, method and the shift id.

### PAY-089 Payment above the remaining is rejected (owner's example)
`[auto-api]` P0
- **Pre:** Remaining 3.500.
- **Steps:** Pay 3.600. Then pay 3.501.
- **Expected:** both 422 on `amount`, the message names the remaining **Rp3.500**; remaining still 3.500; drawer unchanged.

### PAY-090 Exact remaining settles; nothing after
`[auto-api]` P0
- **Pre:** Remaining 3.500.
- **Steps:** Pay 3.500. Then pay 1.
- **Expected:** remaining **0**, status settled, expected cash 102.500 + 3.500 = **106.000**; the Rp1 payment → 422 ("Piutang sudah lunas").

### PAY-091 Amount boundaries
`[auto-api]` P1
- **Pre:** A fresh R, remaining 6.000.
- **Steps:** Pay 0; −1; 2500.5; "2500"; 1.000.000.000.001; then 1; then 5.999.
- **Expected:** the first five → 422; Rp1 accepted → remaining **5.999**; Rp5.999 accepted → remaining **0**.

### PAY-092 Double tap is one payment
`[auto-api]` P0
- **Pre:** Remaining 6.000. Expected cash 100.000.
- **Steps:** Send the 2.500 payment twice with key K7, sequentially and then (fresh receivable) in parallel. Then K7 with `amount: 2000`.
- **Expected:** one payment row; remaining **3.500**; expected cash **102.500**; both calls return the same receivable state; the changed amount under K7 → 422 ("Kunci ini sudah dipakai untuk pembayaran lain"), nothing recorded.

### PAY-093 Two payments race the same kasbon
`[auto-api]` P0
- **Pre:** Remaining 3.500. Two devices, different keys.
- **Steps:** (a) 2.000 and 2.000 in parallel. (b) Fresh R with remaining 3.500: 3.500 and 3.500 in parallel. Repeat each 20 times.
- **Expected:** (a) one succeeds (remaining **1.500**), the other gets 422 naming Rp1.500; (b) exactly one succeeds (remaining **0**), the other gets "sudah lunas". Never a negative remaining, never two accepted in (b), drawer rises by exactly the accepted amount.

### PAY-094 No open shift: cash blocked, transfer and QRIS allowed
`[auto-api]` P0
- **Pre:** Remaining 6.000. Ayu has no open shift. Store QRIS configured.
- **Steps:** Pay 1.000 Tunai; pay 1.000 Transfer; pay 1.000 QRIS Toko.
- **Expected:** cash → 422 ("Buka shift dulu untuk menerima tunai"), remaining 6.000; transfer → accepted, remaining **5.000**; QRIS → accepted, remaining **4.000**; no shift is created; no drawer ledger row.

### PAY-095 Non-cash payments never touch the drawer
`[auto-api]` P0
- **Pre:** Ayu's shift expected 100.000. Remaining 6.000.
- **Steps:** Pay 2.000 Transfer and 1.500 QRIS Toko.
- **Expected:** remaining **2.500**; expected cash still **100.000**; the shift report lists them under their methods, outside the cash column.

### PAY-096 Allowed methods for a kasbon payment
`[auto-api]` P1
- **Pre:** Remaining 6.000.
- **Steps:** Pay with Kasbon; with Debit EDC; with a soft-deleted method; with store B's method id; with QRIS Toko while the store QRIS is not configured.
- **Expected:** Kasbon → 422 (already enforced); deleted and foreign ids → 422 "Metode pembayaran tidak ditemukan"; QRIS unconfigured → 422 with the QRIS message; Debit EDC → the rule lists only Cash / Transfer / QRIS Toko, so assumed 422, but today's code accepts any non-credit method (G-10).

### PAY-097 Remaining is derived from the ledger
`[auto-api]` P0
- **Pre:** A receivable with the history: total 152.070; payments 50.000 (cash), 30.000 (cash), 1.070 (transfer).
- **Steps:** After each payment compare `remaining` from the API with `total − Σ payments` computed from the payment rows in the DB, and with the member's outstanding total and the receivables summary.
- **Expected:** 102.070 → 72.070 → **71.000** at each step, identical in all four places. A direct DB tamper of the stored `rest` (test only) is either impossible (no such column) or ignored by the API.

### PAY-098 A payment taken in a closed shift stays there
`[auto-api]` P0
- **Pre:** Shift S1: float 100.000, cash kasbon payment 2.500, closed (expected 102.500). New shift S2 open, float 100.000.
- **Steps:** Pay the remaining 3.500 in cash in S2.
- **Expected:** S1 unchanged (**102.500**); S2 expected **103.500**; the receivable shows two payments with their own shift ids.

### PAY-099 Kasbon with a cash down payment at the sale **[GAP]**
`[auto-api]` P1
- **Pre:** Ayu's shift expected 100.000.
- **Steps:** Kasbon sale of 4 × P5 with `paid: 1000` (today's API accepts `paid < total`).
- **Expected under today's code:** receivable total 6.000, remaining **5.000**, a first payment of 1.000 in cash, expected cash **101.000**, revenue 6.000 (once). This is two tenders on one receipt and collides with "one method per receipt" (G-01): the owner must either keep it (then the Rp1.000 is a "kasbon payment", not a "cash sale", in the close-shift breakdown) or forbid `paid > 0` on a kasbon sale (422).

### PAY-100 Permission and visibility
`[auto-api]` P1
- **Pre:** Budi has `sales.create` only.
- **Steps:** Budi lists receivables, reads R, pays R.
- **Expected:** 403 for each (`receivables.manage`). Ayu (has it) can do all three. Whether a plain cashier should be able to take a kasbon payment at the till is a product question outside this plan.

### PAY-101 Kasbon payment screen
`[auto-ui]` P1
- **Pre:** R remaining 3.500, Ayu's shift open.
- **Steps:** Open the payment dialog; type 3.600; type 3.500; press pay twice quickly; then view the receivable.
- **Expected:** over-payment shows the inline message with Rp3.500 and keeps the button disabled or returns the 422 on the field; a "pay all" shortcut fills 3.500; the double press creates one payment; the list shows who took it, when and by which method; loading, empty and error states exist; copy is Indonesian.

---

## I. Void of a kasbon receipt

**Money invariants**

- Voiding a kasbon cancels the remaining receivable and returns what was already paid as a cash-out in the currently open shift.
- Unpaid: nothing is returned. Fully paid: everything is returned.
- After the void: `total = Σ payments + cancelled remaining`, and `Σ returned = Σ payments`.
- No payment is accepted on a cancelled receivable.

### PAY-102 Void an unpaid kasbon
`[auto-api]` P0
- **Pre:** Base sale 6.000, no payment. Ayu's shift expected 100.000.
- **Steps:** Void.
- **Expected:** receivable cancelled: remaining **0**, cancelled amount 6.000; cash returned **0**; expected cash **100.000**; stock P5 +4; revenue −6.000, COGS −4.400; the member's outstanding drops by 6.000.

### PAY-103 Void a partly paid kasbon, payment taken in a closed shift
`[auto-api]` P0
- **Pre:** Base sale 6.000. Cash payment 2.500 in shift S1 (closed, expected 102.500). Shift S2 open, float 100.000.
- **Steps:** Void in S2.
- **Expected:** remaining 3.500 cancelled; **2.500** returned as a cash-out in S2: expected 100.000 − 2.500 = **97.500**; S1 still **102.500**; ledger check 6.000 = 2.500 paid + 3.500 cancelled; history lists the returned instalment.

### PAY-104 Void a fully paid kasbon
`[auto-api]` P0
- **Pre:** Base sale 6.000, payments 2.500 and 3.500 in cash in the open shift (expected 100.000 + 6.000 = 106.000).
- **Steps:** Void.
- **Expected:** returned **6.000**; expected cash 106.000 − 6.000 = **100.000**, shown as kasbon payments 6.000 and returned by void 6.000; receivable cancelled with nothing left to cancel; revenue −6.000.

### PAY-105 Void a kasbon whose instalments were paid by transfer **[OPEN DECISION]**
`[auto-api]` P1
- **Pre:** Base sale 6.000: 2.500 cash and 3.500 transfer paid. Expected cash 102.500.
- **Steps:** Void.
- **Expected per current design:** all 6.000 leaves the drawer: expected 102.500 − 6.000 = **96.500** (the drawer pays out Rp3.500 it never received). Alternative: only the cash part leaves the drawer (**100.000**) and 3.500 is returned by transfer. Same decision as PAY-056.

### PAY-106 Void a paid kasbon with no open shift **[GAP]**
`[auto-api]` P1
- **Pre:** (a) Unpaid kasbon; (b) partly paid kasbon. No open shift anywhere.
- **Steps:** Void each.
- **Expected:** (b) blocked with the clear "open a shift" error. (a) returns no money, so the rule's reason for blocking does not apply; assumed blocked as well for one simple rule, confirm (G-11).

### PAY-107 Void races a payment on the same kasbon
`[auto-api]` P0
- **Pre:** Remaining 3.500 (2.500 already paid in cash). Expected cash 102.500.
- **Steps:** In parallel: a cash payment of 3.500 and the void. Repeat 20 times.
- **Expected:** one of two consistent ends. Payment first: it is accepted, then the void returns 6.000 → expected 102.500 + 3.500 − 6.000 = **100.000**. Void first: returns 2.500 → expected **100.000**, and the payment gets 422 (receivable cancelled). Either way expected cash is **100.000**, the customer's net is 0, and no payment sits on a cancelled receivable. Afterwards a new payment → 422.

---

## J. Shift and drawer ledger

**Money invariants**

- `expected = opening float + cash sales (gross) + cash kasbon payments + cash from other sources − drawer expenses − cash returned by void − supplier payments from the drawer`.
- "Cash sales (gross)" = Σ totals of cash receipts made in the shift, including ones voided later; the void shows on its own line.
- `difference = counted − expected`: negative = short, positive = over, zero = balanced.
- Non-cash sales, kasbon sales, and pending / failed sales never enter expected cash.
- A closed shift is frozen.

### PAY-108 Every term of the formula in one shift
`[auto-api]` P0
- **Pre:** Tax 0. Ayu opens with float **200.000**.
- **Steps:** Cash sale 108.100 (1 × P3 + 12 pcs P1); kasbon sale 6.000; cash kasbon payment 2.500; QRIS sale 78.000; cash-in from the owner 50.000 (assumed endpoint `POST /shifts/current/cash-in`); drawer expense 20.000; supplier payment from the drawer 50.000; void of an earlier-shift cash receipt of 15.000. Read `GET /shifts/current`.
- **Expected:** 200.000 + 108.100 + 2.500 + 50.000 − 20.000 − 15.000 − 50.000 = **275.600**. Each term is returned as its own field with these values; kasbon sale and QRIS sale appear only in the non-cash breakdown.

### PAY-109 Close shift: short, over, balanced
`[auto-api]` P0
- **Pre:** Three shifts each ending at expected 275.600.
- **Steps:** Close with counted 275.000; 276.000; 275.600.
- **Expected:** differences **−600**, **+400**, **0**; stored `expectedCash` 275.600 and the counted value; the breakdown is stored with the closed shift so the report never recomputes it from live data.

### PAY-110 Close-shift screen shows the source of every rupiah
`[auto-ui]` P0
- **Pre:** The shift of PAY-108.
- **Steps:** Open the close-shift screen; enter 275.000; then 276.000; then 275.600.
- **Expected:** one row per source with its amount and sign (float 200.000; cash sales +108.100; kasbon payments +2.500; other cash in +50.000; drawer expenses −20.000; returned by void −15.000; supplier payments −50.000), total **Rp275.600**; the difference line reads short ("Kurang Rp600"), over ("Lebih Rp400") and balanced ("Sesuai"); the exact Indonesian wording is assumed here and comes from the design. Each row can be opened to list its entries.

### PAY-111 What never enters the drawer
`[auto-api]` P0
- **Pre:** Float 100.000.
- **Steps:** Debit EDC sale 137.000; QRIS sale 78.000; transfer sale 68.500; kasbon sale 6.000; a pending QRIS sale 43.956; a failed cash sale; an expense "outside drawer" 150.000; a supplier payment "outside drawer" 500.000.
- **Expected:** expected cash stays **100.000** through all eight events.

### PAY-112 Count boundaries at close
`[auto-api]` P1
- **Pre:** Expected 115.000.
- **Steps:** Close with `countedCash` 0; (new shift) 1.000.000.000.000; −1; 115000.5; missing.
- **Expected:** 0 → accepted, difference **−115.000**; the maximum → accepted, difference **999.999.885.000**; the last three → 422.

### PAY-113 Closing is safe against double tap and against late writes
`[auto-api]` P0
- **Pre:** Ayu's open shift.
- **Steps:** (a) Send close twice in parallel. (b) In parallel with a close: a cash sale, a kasbon cash payment, a drawer expense, a void cash-out.
- **Expected:** (a) one close; the other gets 409 ("Tidak ada shift yang terbuka") or, if close takes an `Idempotency-Key` as the house rule on state changes asks, the first result (G-15). (b) each racing write is either inside the closed shift's totals or refused because no shift is open; never recorded against the closed shift after its totals were fixed. `expected` stored at close = the formula over the rows that carry that shift id.

### PAY-114 Negative expected cash
`[auto-ui]` P2
- **Pre:** Shift state of PAY-056 (expected −30.536 under the current design).
- **Steps:** Open the current-shift and close-shift screens; close with counted 0.
- **Expected:** the amount shows as a negative rupiah value (−Rp30.536), not as blank, NaN or a positive number; difference 0 − (−30.536) = **+30.536** (over). No 500.

### PAY-115 Cash from other sources **[GAP]**
`[auto-api]` P1
- **Pre:** Open shift, expected 100.000.
- **Steps:** Record a cash-in of 50.000 with a note; try 0, −1 and without an open shift; try as a cashier and as the agent.
- **Expected:** +50.000 → expected **150.000**; bad amounts → 422; no open shift → 422. What counts as "other sources", who may record it, and whether it is income in the P&L are not defined (G-21). Assumed: not revenue, any `sales.create` actor.

---

## K. Expenses, supplier payments, profit and loss

**Money invariants**

- An expense "from drawer" reduces expected cash at once; "outside drawer" never does.
- Supplier payments reduce the drawer only when the cashier chose "from drawer". A supplier payment is its own record and is not an expense in the P&L (the goods are already in COGS when sold).
- `gross profit = revenue − COGS (stored line cost)`; `net profit = gross profit − expenses`.
- Periods (today / week / month) cut at the store timezone's midnight.
- `expenses.manage` gates the expense log and the P&L. A cashier without it sees no profit and no cost.

Endpoints assumed: `POST/GET /expenses` (`amount`, `category`, `note`, `source: 'drawer' | 'outside'`), `POST /purchasing/orders/:id/payments` (`amount`, `source`), `GET /reports/profit-loss?period=today|week|month`.

### PAY-116 Expense from the drawer
`[auto-api]` P0
- **Pre:** Rina's shift expected 115.000.
- **Steps:** Record "Es batu" 20.000 from the drawer.
- **Expected:** expected cash **95.000** immediately; the expense carries the shift id, actor and time; P&L expenses +20.000.

### PAY-117 Expense outside the drawer
`[auto-api]` P0
- **Pre:** Expected 115.000.
- **Steps:** Record "Listrik" 150.000, outside drawer. Repeat with no open shift.
- **Expected:** expected cash **115.000** both times; accepted without a shift; P&L expenses +150.000 each.

### PAY-118 Warning when an expense exceeds drawer cash
`[auto-ui]` P0
- **Pre:** Expected 115.000.
- **Steps:** Enter a drawer expense of 115.000; then 115.001; confirm the warning.
- **Expected:** 115.000 → no warning, expected **0**. On a fresh shift, 115.001 → a warning stating the drawer holds Rp115.000; nothing is saved until the cashier confirms; after confirming, expected **−1**. The API equivalent: the first call returns a "needs confirmation" answer and a second call with the confirm flag and the same key saves once (assumed contract).

### PAY-119 Drawer expense needs an open shift; amount validation
`[auto-api]` P1
- **Pre:** No open shift, then an open shift.
- **Steps:** Drawer expense 20.000 with no shift; then with a shift: 0; −5; 1.5; 1.000.000.000.001; a missing category; a 1.000-character note; `source: "bank"`.
- **Expected:** no shift → 422 with a clear message; each bad input → 422 on its field; nothing saved.

### PAY-120 Expense create is idempotent
`[auto-api]` P1
- **Pre:** Expected 115.000.
- **Steps:** Post the 20.000 drawer expense twice with key E1; then E1 with 25.000.
- **Expected:** one expense; expected **95.000**; the altered body under E1 → 422.

### PAY-121 Supplier payment: the cashier chooses the source
`[auto-api]` P0
- **Pre:** An approved purchase order of Rp500.000 to Indofood, unpaid. Rina's shift expected 115.000.
- **Steps:** Pay 50.000 "from drawer". Pay 450.000 "outside drawer". Then pay 1 more. Then (fresh PO) pay from the drawer with no open shift. Then omit `source`.
- **Expected:** after the first, expected **65.000** and PO outstanding 450.000; after the second, expected still **65.000**, outstanding **0**; the extra Rp1 → 422 (assumed: no over-payment); no shift → 422; missing `source` → 422 (no silent default, the cashier must choose).

### PAY-122 A supplier payment is not an expense
`[auto-api]` P0
- **Pre:** Today: one cash sale of 12 pcs P1 (revenue 39.600, COGS 33.600); a drawer expense 2.000; a supplier payment from the drawer 50.000 for the Indomie purchase.
- **Steps:** Read the P&L for today and the expense log.
- **Expected:** revenue **39.600**; COGS **33.600**; gross profit **6.000**; expenses **2.000**; net profit **4.000**. The 50.000 appears in the supplier-payment list and in the shift's cash-out, in neither COGS nor expenses (otherwise net would be −46.000).

### PAY-123 P&L arithmetic, tax 0
`[auto-api]` P0
- **Pre:** One day: sales 3 × P2 cash (15.000 / cost 6.000), 1 × P3 debit (68.500 / 61.000), 4 × P5 kasbon unpaid (6.000 / 4.400); expenses 20.000 (drawer) and 5.000 (outside).
- **Steps:** `GET /reports/profit-loss?period=today`.
- **Expected:** revenue 15.000 + 68.500 + 6.000 = **89.500**; COGS 6.000 + 61.000 + 4.400 = **71.400**; gross profit **18.100**; expenses **25.000**; net profit **−6.900** (a loss is shown as a negative number, not clamped to 0). The unpaid kasbon counts as revenue.

### PAY-124 Tax in the P&L **[GAP]**
`[auto-api]` P1
- **Pre:** `taxBps: 1100`. One sale: design example (subtotal 117.600, tax 12.936, total 130.536, cost 100.800).
- **Steps:** Read the P&L and the existing sales report.
- **Expected:** the existing report defines revenue = Σ totals = **130.536** and gross profit = revenue − tax − cost = **16.800**. The owner rule says "revenue − COGS = gross profit", which on the same revenue gives 29.736 and counts tax owed as profit. Assumed correct: P&L revenue excludes tax (**117.600**), gross profit **16.800**, and tax collected (12.936) shown on its own line. Confirm (G-02); the two reports must agree.

### PAY-125 Period filters and the store-day boundary
`[auto-api]` P0
- **Pre:** Store timezone Asia/Jakarta (UTC+7). Clock injected at Tuesday 2026-11-24 10:00 WIB. Expenses (outside drawer) of 1.000 each at: 23 Nov 23:59:59 WIB (16:59:59Z), 24 Nov 00:00:00 WIB (23 Nov 17:00:00Z), 1 Nov 00:00:00 WIB (31 Oct 17:00:00Z), 31 Oct 23:59:59 WIB.
- **Steps:** Read P&L for today, week, month.
- **Expected:** today (24 Nov): **1.000** (only the 00:00:00 one); month (November): **3.000** (1 Nov, 23 Nov, 24 Nov; the 31 Oct one is out); week: assumed Monday-start (23 to 29 Nov) → **2.000**; the week definition is not in the rules (G-22). Changing the store timezone to Asia/Jayapura (UTC+9) moves the 23:59:59 WIB expense (01:59:59 WIT on 24 Nov) into today → **2.000**.

### PAY-126 Permission: no profit without `expenses.manage`
`[auto-api]` P0
- **Pre:** Budi (`sales.create` only); a staff member with `reports.view` but not `expenses.manage`; Rina (has it); owner.
- **Steps:** Each calls the expense list, expense create, the P&L, `GET /sales`, `GET /sales/:id` and the receipt.
- **Expected:** Budi: 403 on expenses and P&L; his sale responses contain no `costTotal`, cost or profit field. Rina and the owner: allowed. The `reports.view`-only actor: 403 on P&L and expenses by the rule, yet today's `/reports/sales` gives that actor `cost` and `grossProfit`: the two permissions overlap and need one decision (G-23).

### PAY-127 Expense and P&L screens
`[auto-ui]` P1
- **Pre:** Rina signed in; then Budi.
- **Steps:** Rina: add both kinds of expense, switch today / week / month, view an empty month, force an API error. Budi: look for the menu entries and open the URLs directly.
- **Expected:** source choice is explicit (drawer / outside) with the drawer effect explained; totals match PAY-123 arithmetic; loading, empty and error states present; Indonesian copy. Budi sees no menu entry (`nav.ts` permission) and the direct URL shows a no-access state, never numbers.

### PAY-128 Expenses in a closed shift
`[auto-api]` P1
- **Pre:** Drawer expense 20.000 recorded in S1; S1 closed.
- **Steps:** Edit its amount; delete it; add a correcting entry today.
- **Expected:** edit and delete refused (the closed shift's expected cash must not move); a correction is a new entry dated today. Whether an expense can be edited at all while its shift is open is not specified; assumed append-only with a reversal.

---

## L. Agent (MCP) limits

**Invariants**

- The agent cannot void, cannot change a price, cannot record a drawer cash-out.
- Every agent write is a preview first, then `confirm: true` with an idempotency key.
- No open shift → a clear error. The agent never opens a shift unless the user asks.
- The void PIN never passes through the agent.

Tool names are assumed (`pos.create_sale`, `pos.record_expense`, `pos.pay_supplier`, `pos.void_sale`, `pos.open_shift`).

### PAY-129 The agent cannot void
`[auto-api]` P0
- **Pre:** Agent session acting for the owner (who holds every permission). A voidable sale.
- **Steps:** Look for a void tool; call the void endpoint with the agent's credentials, with `confirm: true`, with a correct PIN in the arguments.
- **Expected:** no void tool is listed; the endpoint refuses the agent actor (403) even with a correct PIN and owner permissions; the PIN counter does not move; no tool schema has a `pin` field; the transcript and logs hold no PIN.

### PAY-130 The agent cannot change a price or a discount
`[auto-api]` P0
- **Pre:** Agent acting for the owner. Open shift. Tax 0.
- **Steps:** Agent previews and confirms a sale of 12 pcs P1 with `price: 1000` and `discount: 5000`.
- **Expected:** the preview and the sale both show 12 × 3.300 = **39.600**, discount 0; `overrideBy` null. `sales.price_override` is never honoured for the agent actor.

### PAY-131 The agent cannot take cash out of the drawer
`[auto-api]` P0
- **Pre:** Open shift, expected 115.000.
- **Steps:** Agent records an expense with `source: drawer` (20.000); pays a supplier with `source: drawer` (50.000); then the same two with `source: outside`.
- **Expected:** the two drawer writes are refused with a clear message, at preview and at confirm; expected cash stays **115.000**. The two "outside" writes succeed after confirm; expected cash still 115.000; P&L expenses +20.000 only.

### PAY-132 Preview then confirm
`[auto-api]` P0
- **Pre:** Open shift.
- **Steps:** Agent calls the expense tool (outside, 20.000) without `confirm`. Then with `confirm: true` and key A1. Then again with A1. Then `confirm: true` with no key. Then confirm with A2 and an amount different from the preview.
- **Expected:** preview: returns what would be written, writes nothing (row counts unchanged). Confirm A1: one expense. Replay A1: the same expense, still one. No key: 422. The changed amount is a new, separately previewable request; it never rides on the earlier preview.

### PAY-133 Agent sale with no open shift
`[auto-api]` P0
- **Pre:** No open shift for the acting user.
- **Steps:** Agent previews, then confirms a cash sale. Then the user says "open the shift with Rp100.000 and sell it".
- **Expected:** first: a clear error ("Buka shift dulu sebelum berjualan") at preview already; no shift row is created by the agent on its own. Second: opening the shift is itself previewed and confirmed (float **100.000**), then the sale goes through.

### PAY-134 Agent and kasbon cash **[GAP]**
`[auto-api]` P1
- **Pre:** R remaining 6.000. Open shift.
- **Steps:** Agent records a kasbon payment of 2.500 in cash; then by transfer.
- **Expected:** the rules forbid a drawer cash-out and say nothing of a drawer cash-in. Assumed: transfer allowed (preview/confirm), cash refused, because the agent cannot see the money enter the drawer (G-24).

### PAY-135 Agent retries do not duplicate money
`[auto-api]` P1
- **Pre:** Open shift, P2 stock 50.
- **Steps:** Agent confirms a cash sale of 3 × P2 with key A7; the tool call times out; the agent retries A7 three times.
- **Expected:** one sale of **15.000**, stock 47, drawer +15.000, one payment in payment-api.

---

## M. Reports and audit after a void

**Money invariants**

- Over any period that contains both a sale and its void, the pair contributes 0 to revenue, tax, COGS, profit, quantity sold and receivables.
- Sum of method columns = revenue. JSON and CSV agree.
- The audit trail is append-only and names starter, approver, reason, time, amounts and the shift that paid out.

### PAY-136 Same-day void nets every report to zero
`[auto-api]` P0
- **Pre:** `taxBps: 1100`. Today: sale A (design example, 130.536, cost 100.800) and sale B (3 × P2: subtotal 15.000, tax 1.650, total 16.650, cost 6.000), both cash.
- **Steps:** Void A. Read dashboard, sales report, product report, P&L.
- **Expected:** revenue 147.186 − 130.536 = **16.650**; tax 14.586 − 12.936 = **1.650**; COGS 106.800 − 100.800 = **6.000**; gross profit (ex tax) **9.000**; P1 quantity sold 0 pcs, P2 3; cash column 16.650. Whether the voided receipt still counts in "number of sales" (2, or 1 plus "1 void") is not specified; assert the count of voids is shown separately.

### PAY-137 Shift report after voids
`[auto-api]` P0
- **Pre:** State after PAY-081 (S1 closed 23 Nov, sale voided in S2 on 24 Nov).
- **Steps:** Read `/reports/shifts` and its CSV for 23 to 24 Nov.
- **Expected:** S1 row: cash sales 15.000, expected 115.000, counted 115.000, difference 0 (unchanged). S2 row: returned by void 15.000, expected 85.000. CSV values equal JSON values.

### PAY-138 Receivables report after a kasbon void
`[auto-api]` P0
- **Pre:** Two kasbon for Bu Sari: R1 6.000 with 2.500 paid; R2 152.070 unpaid. Open total 3.500 + 152.070 = **155.570**, open count 2.
- **Steps:** Void R1's sale. Read the receivables list, summary and member page.
- **Expected:** open total **152.070**, open count **1**; R1 shows as cancelled (not as settled, not as open) with paid 2.500, returned 2.500, cancelled 3.500; filters `open` and `settled` both exclude it or a `cancelled` filter exists.

### PAY-139 Report consistency across exports
`[auto-api]` P1
- **Pre:** A day with cash, QRIS, debit and kasbon sales, one void and one kasbon void.
- **Steps:** Compare `/reports/sales`, its CSV, `/reports/products`, the dashboard and the P&L for the same range.
- **Expected:** the same revenue, tax and COGS in every one; Σ product-line sales = subtotal net of voids; Σ method columns = revenue; no CSV cell holds a decimal or a formula-leading character from a void reason (`=`, `+`, `-`, `@` are escaped).

### PAY-140 Void audit trail
`[auto-api]` P0
- **Pre:** A void started by Ayu, approved by Rina, reason "Salah input barang", after two wrong PIN attempts.
- **Steps:** Read the void history (assumed `GET /sales/:id` → `void`, and an activity list). Try to edit or delete the entry by any endpoint. Query the DB row.
- **Expected:** started by Ayu; approved by Rina; reason; timestamp; original receipt number; amount returned; method of return; the shift that paid out; the device (if recorded). The failed attempts are recorded as events without the entered digits. No PIN, no hash. No endpoint mutates or removes the entry.

### PAY-141 Receipt of a voided sale
`[auto-ui]` P2
- **Pre:** A voided receipt.
- **Steps:** Open it from history and reprint.
- **Expected:** clearly marked as cancelled ("DIBATALKAN") with date, reason and approver name; original amounts still shown; it cannot be voided again from the screen (button absent or disabled with the reason).

---

## N. Multi-tenancy, validation and logs

**Invariants**

- The tenant comes from the session only. Store B gets 404 on store A's ids for read, update and delete.
- Bad input answers 422, never 500, and never echoes SQL, stack traces, table names or gateway payloads.
- Logs never contain PINs, tokens, phone numbers or customer names.

### PAY-142 Cross-tenant matrix for the new money resources
`[auto-api]` P0
- **Pre:** Store A has: a sale, a pending QRIS sale, a void record, a receivable with a payment, an expense, a supplier payment, an open shift, a closed shift, an admin with a PIN. Store B session (owner).
- **Steps:** With B's session and A's ids: read / void / refund / confirm the sale; read / pay the receivable; read / update / delete the expense; read / create the supplier payment on A's order; read A's shifts; record a drawer entry against A's shift id; set, use and unlock A's admin PIN; read A's P&L by passing A's tenant id as a query or body field.
- **Expected:** 404 for every id-addressed call; the tenant id in query or body is refused (422, strict schema) or ignored, and the answer holds only B's data; A's rows are unchanged; A's admin has no failed attempts.

### PAY-143 New tables obey the table rules
`[auto-api]` P0
- **Pre:** Migrations applied.
- **Steps:** Run `test/db.e2e-spec.ts` and `test/purge.e2e-spec.ts`; list new `pos` tables (voids / reversals, drawer ledger, expenses, supplier payments, void-PIN attempts, payment references).
- **Expected:** each has RLS enabled, a `tenant_id` FK to `pos.tenants`, is exported from `db/schema/index.ts`, and is emptied by the purge for that tenant. With the `pos_app` role and the wrong tenant setting, a direct `select` returns 0 rows.

### PAY-144 Validation: 422, never 500
`[auto-api]` P0
- **Pre:** None.
- **Steps:** For each new write endpoint (void, refund, confirm, kasbon payment, expense, supplier payment, cash-in, PIN set / unlock) send: a non-UUID id; an empty body; an array body; `null`; unknown extra keys; amounts as string, float, negative, `1e12 + 1`, `9007199254740993`; an `Idempotency-Key` of 7 chars, 101 chars, and with spaces; a 1 MB body.
- **Expected:** 422 (or 400 / 413 for a malformed or oversized payload) with a field-level message; never 500; nothing written.

### PAY-145 Errors do not echo internals
`[auto-api]` P1
- **Pre:** Force: a DB constraint failure in a void; payment-api returning a 500 with a gateway body; a timeout.
- **Steps:** Read the HTTP answers.
- **Expected:** a generic Indonesian message and a status; no SQL text, constraint or table name, stack trace, file path, payment-api URL, PG response body or secret in the answer.

### PAY-146 No secrets in logs
`[auto-api]` P0
- **Pre:** Capture pos-api and payment-api logs during a run of: PIN set, 5 wrong PINs, a correct void, an owner unlock, a kasbon payment for "Bu Sari" (member with a phone number), a static-QRIS sale, an agent write.
- **Steps:** Search the captured logs for `482913`, each wrong PIN used, the session token, the `POS_SERVICE_KEY`, the payment-api credential, "Sari", her phone number. Run the existing `guards.spec.ts`.
- **Expected:** none found; no `console` call in `src/`; request-body logging, if any, redacts `pin`.

### PAY-147 Permissions are code-defined and seeded
`[auto-api]` P1
- **Pre:** A new store; an existing store created before the change.
- **Steps:** Read `permissions.ts` and both stores' roles. Call each new endpoint without its permission.
- **Expected:** `sales.void` and `expenses.manage` exist as keys; the owner role holds them in both stores; the default cashier role holds neither; every new endpoint carries `@RequirePermission` and answers 403 without the key (void, refund, expense, P&L, supplier payment, cash-in, PIN management).

---

## Worked end-to-end money scenarios

Each scenario is one shift with many events. "Expected cash" is the value `GET /shifts/current` must return after
the event. Automate each as one e2e spec that asserts the column after every step, then the closing formula.
Report rows assume a void's reversal is dated at the time of the void (G-09); the multi-day totals hold either way.

### Scenario 1: an ordinary day, tax 0, one cashier (Ayu), store in WIB

Opening stock: P2 50, P1 100 pcs, P3 10, P5 40. Approver: Rina.

| # | Time | Event | Detail and arithmetic | Drawer Δ | Expected cash | Revenue (cum.) | COGS (cum.) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 07:00 | Open shift | float 200.000 | +200.000 | 200.000 | 0 | 0 |
| 2 | 07:15 | Sale #1 cash | 3 × P2 = 15.000; tendered 20.000; change 5.000 | +15.000 | 215.000 | 15.000 | 6.000 |
| 3 | 08:02 | Sale #2 cash | 1 × P3 68.500 + 12 pcs P1 39.600 = 108.100; tendered 110.000; change 1.900 | +108.100 | 323.100 | 123.100 | 100.600 |
| 4 | 09:30 | Sale #3 kasbon (Bu Sari) | 4 × P5 = 6.000; paid 0 | 0 | 323.100 | 129.100 | 105.000 |
| 5 | 10:10 | Sale #4 QRIS Toko | 1 dus P1 = 78.000 | 0 | 323.100 | 207.100 | 172.200 |
| 6 | 10:45 | Expense, from drawer | es batu 20.000 | −20.000 | 303.100 | 207.100 | 172.200 |
| 7 | 11:20 | Kasbon payment, cash | 2.500 on #3; remaining 6.000 − 2.500 = 3.500 | +2.500 | 305.600 | 207.100 | 172.200 |
| 8 | 12:05 | Sale #5 Debit EDC | 2 × P3 = 137.000 | 0 | 305.600 | 344.100 | 294.200 |
| 9 | 13:00 | Supplier payment, from drawer | Indofood 50.000 | −50.000 | 255.600 | 344.100 | 294.200 |
| 10 | 13:40 | Void sale #1 | cash 15.000 returned; stock P2 +3 | −15.000 | 240.600 | 329.100 | 288.200 |
| 11 | 14:15 | Expense, outside drawer | listrik 150.000 by transfer | 0 | 240.600 | 329.100 | 288.200 |
| 12 | 15:00 | Kasbon payment, transfer | 1.000 on #3; remaining 3.500 − 1.000 = 2.500 | 0 | 240.600 | 329.100 | 288.200 |
| 13 | 16:00 | Sale #6 cash | 5 × P2 = 25.000; exact | +25.000 | 265.600 | 354.100 | 298.200 |
| 14 | 17:00 | Close shift | counted 265.000 | | 265.600 | | |

COGS per sale: #1 3 × 2.000 = 6.000; #2 61.000 + 12 × 2.800 = 94.600; #3 4 × 1.100 = 4.400; #4 24 × 2.800 = 67.200;
#5 2 × 61.000 = 122.000; #6 5 × 2.000 = 10.000.

**Close-shift breakdown (must reconcile to the rupiah)**

| Source | Amount |
| --- | --- |
| Opening float | 200.000 |
| + Cash sales, gross (15.000 + 108.100 + 25.000) | 148.100 |
| + Cash kasbon payments | 2.500 |
| + Cash from other sources | 0 |
| − Drawer expenses | 20.000 |
| − Cash returned by void | 15.000 |
| − Supplier payments from drawer | 50.000 |
| **Expected** | **265.600** |
| Counted | 265.000 |
| **Difference (counted − expected)** | **−600 (short)** |

**End-of-day checks**

- Revenue net of void: 369.100 − 15.000 = **354.100**. By method: cash 108.100 + 25.000 = 133.100; kasbon 6.000; QRIS 78.000; debit 137.000; sum 354.100.
- COGS: 304.200 − 6.000 = **298.200**. Gross profit 354.100 − 298.200 = **55.900**.
- Expenses 20.000 + 150.000 = **170.000** (the 50.000 supplier payment is not in it). Net profit 55.900 − 170.000 = **−114.100**.
- Receivable #3: 6.000 − 2.500 − 1.000 = **2.500** open.
- Stock: P2 50 − 3 + 3 − 5 = **45**; P1 100 − 12 − 24 = **64** pcs; P3 10 − 1 − 2 = **7**; P5 40 − 4 = **36**.
- Kasbon payments (3.500 in total) added nothing to revenue.

### Scenario 2: tax 11%, voucher, void of a closed-shift receipt, void of a partly paid kasbon

**The day before (23 Nov), shift S1, closed, must stay frozen.** Float 100.000. Sale #11 cash: design example,
total 130.536 (tax 12.936, cost 100.800). Sale #12 kasbon (Pak Joko): 2 × P3 = 137.000, tax 15.070, total 152.070,
cost 122.000. Cash kasbon payment on #12: 50.000 (remaining 102.070). S1 expected = 100.000 + 130.536 + 50.000 =
**280.536**; counted 280.536; difference 0.

**24 Nov, shift S2 (Ayu), tax 11%.** Stock at open: P1 164 pcs, P3 18, P2 50, P5 40. `HEMAT10` quota 5.

| # | Event | Detail and arithmetic | Drawer Δ | Expected cash (S2) |
| --- | --- | --- | --- | --- |
| 1 | Open shift | float 150.000 | +150.000 | 150.000 |
| 2 | Sale #13 cash, voucher `HEMAT10` | 2 × P2 10.000 + 1 × P3 68.500 + 1 × P5 1.500 = 80.000; voucher 8.000; taxable 72.000; tax 7.920; total 79.920; tendered 100.000; change 20.080 | +79.920 | 229.920 |
| 3 | Void sale #11 (closed shift S1), Rina approves | 130.536 returned from S2; S1 untouched; P1 +36 pcs | −130.536 | 99.384 |
| 4 | Kasbon payment, cash, on #12 | 30.000; remaining 102.070 − 30.000 = 72.070 | +30.000 | 129.384 |
| 5 | Sale #14 QRIS Toko | 12 pcs P1 = 39.600; tax 4.356; total 43.956 | 0 | 129.384 |
| 6 | Void kasbon sale #12 (partly paid) | paid so far 50.000 + 30.000 = 80.000 returned; remaining 72.070 cancelled; P3 +2 | −80.000 | 49.384 |
| 7 | Drawer expense attempt 60.000 | warning: drawer holds 49.384; cashier cancels | 0 | 49.384 |
| 8 | Drawer expense | 25.000 (no warning) | −25.000 | 24.384 |
| 9 | Cash from other sources | owner adds change money 100.000 | +100.000 | 124.384 |
| 10 | Sale #15 cash | 1 dus P1 78.000; tax 8.580; total 86.580; tendered 100.000; change 13.420 | +86.580 | 210.964 |
| 11 | Void attempt on #15: Rina's PIN wrong 5 times | locked 300 s; correct PIN at 4:59 refused; nothing voided | 0 | 210.964 |
| 12 | Close shift | counted 211.000 | | 210.964 |

**Close-shift breakdown**

| Source | Amount |
| --- | --- |
| Opening float | 150.000 |
| + Cash sales, gross (79.920 + 86.580) | 166.500 |
| + Cash kasbon payments | 30.000 |
| + Cash from other sources | 100.000 |
| − Drawer expenses | 25.000 |
| − Cash returned by void (130.536 + 80.000) | 210.536 |
| − Supplier payments from drawer | 0 |
| **Expected** | **210.964** |
| Counted | 211.000 |
| **Difference** | **+36 (over)** |

**Checks**

- S1 after the day: expected still **280.536**, cash sales 130.536, kasbon payments 50.000, difference 0, same `closedAt`.
- Receivable #12: 152.070 = 50.000 + 30.000 (paid, returned 80.000) + 72.070 (cancelled). Remaining 0, status cancelled. Pak Joko's outstanding: 0.
- Voucher quota 5 → **4**. Rina: locked, counter cleared only by expiry, success or owner unlock; sale #15 not voided.
- Stock: P1 164 + 36 − 12 − 24 = **164** pcs; P3 18 − 1 + 2 = **19**; P2 **48**; P5 **39**.
- 24 Nov alone (reversals dated 24 Nov): net sales ex tax 72.000 + 39.600 + 78.000 − 117.600 − 137.000 = **−65.000**; tax 7.920 + 4.356 + 8.580 − 12.936 − 15.070 = **−7.150**; revenue incl. tax **−72.150**; COGS 66.100 + 33.600 + 67.200 − 100.800 − 122.000 = **−55.900**; gross profit ex tax **−9.100**; expenses 25.000; net **−34.100**. A negative revenue day is the visible effect of the dating policy (G-09).
- 23 to 24 Nov together (holds under either policy): net sales ex tax **189.600**; tax **20.856**; COGS **166.900**; gross profit **22.700**, exactly the three surviving sales #13, #14, #15 (72.000 − 66.100) + (39.600 − 33.600) + (78.000 − 67.200) = 5.900 + 6.000 + 10.800.

### Scenario 3: evening shift across midnight (WITA), races, retries, and the open QRIS-void decision

Store timezone Asia/Makassar (UTC+8). Tax 0. Cashier Budi (given `receivables.manage` for this scenario), a second
device also signed in as Budi for the races (so the winning write always lands in this shift). Approvers Rina and Dedi. Opening stock: P1 200 pcs, P2 50, P3 10, P5 40.

| # | Time (WITA) | Event | Detail and arithmetic | Drawer Δ | Expected cash |
| --- | --- | --- | --- | --- | --- |
| 1 | 16:00 | Open shift | float 300.000 | +300.000 | 300.000 |
| 2 | 16:20 | Sale #21 cash | 47 pcs P1 × 3.300 = 155.100; tendered 160.000; change 4.900 | +155.100 | 455.100 |
| 3 | 17:05 | Sale #22 cash, pay pressed twice (same key) | 2 × P2 = 10.000 exact; one sale only | +10.000 | 465.100 |
| 4 | 18:10 | Sale #23 QRIS Toko, payment-api times out, retried with the same key | 48 pcs P1 × 3.200 = 153.600; one payment, one stock draw | 0 | 465.100 |
| 5 | 18:30 | Cash sale attempt, payment-api answers failed | 1 × P3; no sale, no stock change | 0 | 465.100 |
| 6 | 19:00 | Sale #24 kasbon (Bu Sari) | 4 × P5 = 6.000; paid 0 | 0 | 465.100 |
| 7 | 20:15 | Two cash kasbon payments of 3.500 race (two devices) | one accepted (remaining 2.500); the other 422, 3.500 > 2.500 | +3.500 | 468.600 |
| 8 | 20:16 | Kasbon payment 2.600, then 2.500 | 2.600 → 422; 2.500 → settled | +2.500 | 471.100 |
| 9 | 21:00 | Supplier payment 500.000 outside drawer, then 120.000 from drawer | only the second moves the drawer | −120.000 | 351.100 |
| 10 | 21:30 | Expense, from drawer | parkir and bensin 15.000 | −15.000 | 336.100 |
| 11 | 23:40 | Sale #25 cash | 1 × P3 68.500; tendered 70.000; change 1.500 | +68.500 | 404.600 |
| 12 | 00:10 (+1 day) | Void #25, started on two devices at once | one void (Rina), the other refused; 68.500 returned once | −68.500 | 336.100 |
| 13 | 00:20 | Void fully paid kasbon #24 | 3.500 + 2.500 = 6.000 returned | −6.000 | 330.100 |
| 14 | 00:30 | Void QRIS sale #23 **[OPEN DECISION]** | current design: 153.600 leaves the drawer | −153.600 | 176.500 |
| 15 | 00:45 | Close shift | counted 176.500 | | 176.500 |

If the owner decides store-QRIS voids are returned by bank transfer, row 14 has Δ 0, expected stays **330.100**, and
"cash returned by void" becomes 74.500.

**Close-shift breakdown (current design)**

| Source | Amount |
| --- | --- |
| Opening float | 300.000 |
| + Cash sales, gross (155.100 + 10.000 + 68.500) | 233.600 |
| + Cash kasbon payments (3.500 + 2.500) | 6.000 |
| + Cash from other sources | 0 |
| − Drawer expenses | 15.000 |
| − Cash returned by void (68.500 + 6.000 + 153.600) | 228.100 |
| − Supplier payments from drawer | 120.000 |
| **Expected** | **176.500** |
| Counted | 176.500 |
| **Difference** | **0 (balanced)** |

**Checks**

- Step 3: one sale, stock P2 50 → 48. Step 4: payment-api holds one payment for #23; stock P1 200 − 47 − 48 = 105. Step 5: P3 stays 10 until step 11.
- Step 7: receivable history has exactly one 3.500 payment from that race. Step 8: the ledger is 6.000 − 3.500 − 2.500 = 0.
- Step 12: sale at 15:40Z (23:40 WITA), void at 16:10Z (00:10 WITA next day); history shows one starter and one approver; P3 back to 10.
- Final stock: P1 105 + 48 = **153** pcs; P2 **48**; P3 **10**; P5 40 − 4 + 4 = **40**.
- Day D (before midnight WITA): revenue 155.100 + 10.000 + 153.600 + 6.000 + 68.500 = **393.200**; COGS 131.600 + 4.000 + 134.400 + 4.400 + 61.000 = **335.400**; gross profit **57.800**; expenses 15.000; net **42.800**.
- Day D+1 (reversals only): revenue −68.500 − 6.000 − 153.600 = **−228.100**; COGS −61.000 − 4.400 − 134.400 = **−199.800**; gross profit **−28.300**.
- Both days: revenue **165.100** (sales #21 and #22 only); COGS **135.600**; gross profit **29.500**; expenses 15.000; net **14.500**. The 620.000 paid to suppliers is in none of these.
- The shift report shows this shift once (opened on day D), with its full breakdown; it is not split at midnight.

---

## Open decisions and gaps found while writing

**Open decisions (already known to the owner)**

- **O-1** Change rounding for cash (PAY-027), including where the rounding difference is booked.
- **O-2** Void of transfer and store-QRIS receipts: cash out of the drawer, or bank transfer back (PAY-056, PAY-057, PAY-105, scenario 3 row 14). The current design can drive expected cash below zero.

**Contradictions and gaps**

- **G-01** "One method per receipt, no split" versus today's kasbon with a cash down payment (`paid < total` accepted): PAY-044, PAY-099.
- **G-02** P&L says "revenue − COGS = gross profit"; the existing report defines revenue including tax and gross profit = revenue − tax − cost: PAY-124.
- **G-03** "Void needs `sales.void` AND a PIN" versus "cashier starts, admin enters PIN": who must hold `sales.void`, the starter, the approver, or both: PAY-063.
- **G-04** May one admin both start and approve a void: PAY-063 row 6.
- **G-05** Does the owner (UMKMall login, no staff row) have a void PIN, and who unlocks a locked owner: PAY-063 rows 8 and 9.
- **G-06** PIN lockout details: counter after the lock expires; whether attempts during a lock extend it; whether a counter with fewer than 5 failures ever ages out; whether malformed PINs and non-PIN refusals count; what an idempotent replay does with the PIN: PAY-051, PAY-070, PAY-072, PAY-077, PAY-078.
- **G-07** "The currently open shift" with one open shift per actor: the starter's shift, the approver's, or the sale's own shift when still open: PAY-083.
- **G-08** A void return larger than the drawer cash: warn or block (expenses warn; voids are silent): PAY-056, PAY-085.
- **G-09** Which day a void belongs to in reports (the sale's day or the void's day). Append-only reversal implies the void's day, which can make a day's revenue negative: PAY-084, scenarios 2 and 3.
- **G-10** Kasbon payment methods are "Cash / Transfer / QRIS Toko"; the code accepts any non-credit method, including Debit EDC: PAY-096.
- **G-11** Void of an unpaid kasbon with no open shift returns no money: blocked or allowed: PAY-106.
- **G-12** The same product on two lines in two units (12 pcs + 1 dus) is refused by today's schema ("Satu produk cukup satu baris"): PAY-015.
- **G-13** Price anomalies in the given table: 48 pcs (153.600) is cheaper than 47 pcs (155.100) and than 2 dus (156.000); 24 pcs as pcs (79.200) is dearer than 1 dus (78.000); whether dus quantities count toward the pcs tier: PAY-013, PAY-022.
- **G-14** "Stored cost per pcs on the line" versus FIFO batches: a line drawn from two batches has no single whole-rupiah cost per pcs; the code stores a line cost total, which is the safe form: PAY-049.
- **G-15** Shift open / close and void PIN changes take no `Idempotency-Key` although the house rule asks it of state changes: PAY-113.
- **G-16** Closing a shift while a sale is still pending: PAY-041.
- **G-17** Cash sales when payment-api is down, and when stock is taken (at pending or at completion; the "last unit" race depends on it): PAY-036, PAY-020.
- **G-18** Receipt numbering for failed or cancelled pending sales (gaps in the sequence): PAY-031.
- **G-19** `paid` is capped at 1.000.000.000.000 while a total with tax can exceed it: PAY-011.
- **G-20** Voucher quota restore when the voucher was deleted or expired since: PAY-060.
- **G-21** "Cash from other sources" is undefined (who, what, P&L effect): PAY-115.
- **G-22** Week definition for the P&L filter (Monday start assumed): PAY-125.
- **G-23** `reports.view` already exposes cost and gross profit; the rule gates profit behind `expenses.manage`: PAY-126.
- **G-24** Agent and drawer cash-in (cash kasbon payment, cash sale are not "cash-out"); assumed refused for kasbon cash only: PAY-134.
- **G-25** Void of an EDC debit receipt is not covered by the rules: PAY-058.
- **G-26** Tax rounding mode and the discount allocation rule are not written in the owner rules (half-up and largest-remainder assumed): PAY-006, PAY-008.

---

## Addendum: owner decisions of 24 Nov 2026 (supersede open decisions O-1, O-2 and gaps G about them)

Source: PRD "Keputusan pembayaran", UMK-1962, UMK-1993, payment-api spec rev 17+.

1. **Void of transfer, store QRIS or EDC receipts is returned by transfer back, never from the drawer; expected cash is unchanged.** PAY-056 and every case that expected a drawer cash-out for these methods now expects: no drawer row, expected cash unchanged (not -30.536), the void still records reason, PIN, approver and a "return by transfer" marker. Scenario S3 closes at the figure given for the bank-transfer variant (Rp330.100), not Rp176.500. Cash receipts still go out of the drawer.
2. **An admin may void or refund their own transaction** (PIN and audit still required). Any case that expected refusal of self-approval now expects success with both fields (starter, approver) holding the same person.
3. **A closed-shift void belongs to the shift open at the time of the void** (the old shift is untouched). This answers the "which shift" gap: the shift open when the void is done.

### Cash rounding (owner: cash totals round up to the next Rp100)

| ID | Pri | Case | Expected |
|---|---|---|---|
| RND-001 | P0 | Cash total Rp200.123 | Charged Rp200.200; rounding Rp77 |
| RND-002 | P0 | Cash total on a Rp100 boundary (Rp130.600, Rp100, Rp0 not allowed) | Unchanged; rounding Rp0 |
| RND-003 | P0 | Design cart total Rp130.536, cash, tendered Rp140.000 | Payable Rp130.600 (rounding Rp64); change Rp9.400 |
| RND-004 | P0 | Tendered exactly the rounded total ("Uang pas") | Change Rp0; "uang pas" button uses the rounded amount |
| RND-005 | P0 | Tendered Rp130.599 for payable Rp130.600 | Rejected 422 (below rounded total) |
| RND-006 | P0 | Totals of Rp1, Rp99, Rp101 | Rp100, Rp100, Rp200 |
| RND-007 | P0 | Non-cash methods (QRIS toko, transfer, EDC) | No rounding; exact total |
| RND-008 | P0 | Void of a rounded cash receipt (paid Rp130.600, total Rp130.536) | Cash returned from drawer is Rp130.600 (what was received), expected cash reconciles exactly; reversal of revenue uses the total Rp130.536 and the rounding Rp64 |
| RND-009 | P0 | Shift close after rounded cash sales | Expected cash uses rounded cash amounts; screen shows total "Pembulatan" separately |
| RND-010 | P1 | Rounding with voucher/discount and 11% tax | Tax computed after discounts and before rounding; rounding applied last |
| RND-011 | P1 | Reports: revenue, tax, profit with rounding rows | Rounding never changes tax base, revenue by method sums to cash received |

**Pending (still the payment thread's assumptions, not owner-approved)**: cash only; the difference stored in a separate `rounding` field shown as "Pembulatan" and outside the tax base; kasbon not rounded. Mark RND-007 (kasbon part), RND-008 and RND-011 as *pending owner confirmation*; the other rounding cases hold either way.
