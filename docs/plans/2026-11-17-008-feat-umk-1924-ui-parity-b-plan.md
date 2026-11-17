# UMK-1924 UI parity B: cashier, selling history, purchasing, stock opname

Cross-unit pass on the U3 and U6 screens ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). Owner decision
2026-11-17: every POS screen looks and works like its Lakasir counterpart (layout, fields, flow) but is built from
`@umkmall/ui` (`packages/ui`, vendored) with the UMKMall admin dashboard colours (`apps/pos-web/src/styles/app.css`).
Session `ui-parity-a` owns the app shell, nav config, dashboard, catalog and staff; this pass owns the screens below.
Reference: Lakasir at `tokoa.localhost:8090` (classic `/member/cashier`, never PosV2), source in
`~/Documents/lakasir-test/app/Filament/Tenant/{Resources,Pages}`.

## Goal

The cashier, sales history/detail/receipt, suppliers, purchase orders and stock opname screens match Lakasir screen by
screen, use `@umkmall/ui` components only (no legacy `bg-brand-soft`/`text-ink` token classes, no `staf/-ui` helpers),
render inside the shell once `feat(web): app shell` is on `main`, and every action works end to end against pos-api.

## Screens

| Lakasir screen | POS route | `@umkmall/ui` components | Gaps / decisions |
|---|---|---|---|
| Cashier (classic): product grid + search (left), "Orders details" panel: items with `+ qty − 🗑`, Member / Note / Voucher rows, Sub total / Tax / Total, "Proceed to payment" | `/kasir` | `Card`, `TextField` (search), `Tabs` (category tabs), `Button`, `Badge`, `Dialog` (note), `Alert`, `Skeleton` | Category tabs: Lakasir filters by category in the search; ours is a tab strip from the products' categories. **Note** is added to the sale (pos-api `sales.note`, receipt, detail). **Member and voucher** rows are shown but inactive until U7 wires them (U7 plan: "added as small pieces to the cashier screen once ui-parity-b's rebuild is on main"). Product stock and image on the card: not in the catalog list response; deferred (no N+1 calls). |
| Payment modal: payment method tabs (Cash / Kasbon), totals, "Money changes" field, quick amounts, "No change", numpad, "Pay it" / "Close" | `/kasir` dialog | `Dialog` (large), `SegmentedControl` (method), `TextField`, `Button` grid | Only Tunai until U7 adds payment methods; the method control shows Tunai alone. Items list on the right of the modal like Lakasir. |
| Success modal: check, "Change: IDR …", Print / Close | `/kasir` dialog | `Dialog`, `Text`, `Button` | Print opens `/kasir/struk/$id`; Close returns to an empty order. |
| Cash drawer open / close (Lakasir: header action on the cashier) | `/kasir` (open form when no shift), `/kasir/tutup` | `Card`, `TextField`, `Button`, `Alert` | Same flow as U3; restyled. |
| Selling Histories: overview widgets (today revenue, sales today, discount today), table Code / Cashier / Member / Customer number / Date / Grand total / Total price / Tax / Total cost, filters cashier + date range, pagination | `/kasir/riwayat` | `Table` (`DataTable` server-side), `Pagination`, `DateTimeInput`/`TextField type=date`, `Select`, `Card` | pos-api `GET /sales` gains `from`/`to` (store-local dates) and returns `cashier` name, `subtotal`, `tax`, `discount`; cost shown only with `reports.view` (already the rule). Member / customer number columns arrive with U7. Overview widgets: today's totals computed from the same list query (`summary` in the response); U5 owns full reports. Cashier filter: deferred (needs a staff list the cashier may not read). |
| View selling: "Selling details" (code, cashier, date, payment method, voucher), "Member details", product table (unit price, qty, discount, total), Subtotal / Discount / Tax / Total / Paid / Change, "Print receipt" | `/kasir/riwayat/$id` (new) | `Card`, `Table`, `Button` | Uses `/sales/:id/receipt` (has cashier name). Member details: U7. Print invoice (A4): not built; receipt print only. |
| Print receipt (browser printer) | `/kasir/struk/$id` | `Button` (outside the printed area) | Receipt body stays plain monospace for 58/80 mm paper; shows the note. |
| Suppliers: table Name / Phone / Address, "New supplier" modal form, edit / delete row actions, empty state | `/pemasok` | `Table`, `Dialog` (form), `TextField`, `Button`, `Alert` | Same fields as Lakasir. |
| Purchasings: table Supplier / Number / Date / Stocks count / Approved at / Status, status + date filters, "New purchasing" | `/pembelian` | `Table`, `Badge` (status), `Select` (status filter), `Button` | Filters applied client-side on the list (all rows are returned). Lakasir's number, date, due date, image and payment status are not in U6's model: deferred (see below). |
| Create purchasing (Supplier, Payment method, …) then add stock lines on the view page | `/pembelian/baru` | `Select` (supplier), `TextField`, line table with `Table`, `Button` | U6 creates the order with lines in one call; kept (one screen, header grid + lines table, like Lakasir's create + relation manager). |
| View purchasing: status, supplier, lines, "Update status" (approve / cancel) | `/pembelian/$id` | `Card`, `Table`, `Badge`, `Dialog` (confirm) | Approve raises stock (U6). |
| Stock opnames: table Number / Items count / Date / Approved at / Status, filters, "New stock opname" | `/stok-opname` | `Table`, `Badge`, `Select`, `Button` | Number and PIC are not in U6's model: deferred. |
| Create / view stock opname: items (product, system qty, counted qty, difference, reason), approve | `/stok-opname/baru`, `/stok-opname/$id` | `Table`, `TextField`, `Select`, `Dialog` (confirm), `Badge` | Approve adjusts stock (U6). |

Shared pieces live in `apps/pos-web/src/components/pos/` (page header, money format, loading/error/empty states), so
these screens stop importing `staf/-ui`, which `ui-parity-a` owns.

## Definition of Done

- [test] pos-api `GET /sales?from=&to=`: only sales in the range; response rows carry `cashier`; store B never sees
  store A's sales (cross-tenant, list and detail).
- [test] pos-api sale `note`: stored, trimmed, ≤ 200 chars (422 above), on the receipt; omitted → null.
- [test] pos-web `-money` helpers unchanged (existing tests) plus quick amounts / numpad edit rule.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` with `PGTEST_DB=pos_uipb`; CI green on `main`.
- [cmd] `grep -rn "bg-brand-soft\|text-ink\|staf/-ui" apps/pos-web/src/routes/{kasir,pemasok,pembelian,stok-opname}`
  finds nothing.
- [qa] Browser, local pos-api + pos-web: open a shift, sell with cash (quick amount and numpad), success dialog with
  change, print the receipt, see the sale in history and its detail, close the shift; create a supplier, a purchase,
  approve it and see stock rise; create and approve a stock opname. Screenshots of each Lakasir screen and its POS
  screen at the same size in `.evidence/ui-parity-b/` (gitignored).
- [manual] Final state per screen recorded in the table above; comment on UMK-1924 listing the screens and what was
  not exercised.

## Files

- `apps/pos-web/src/routes/{kasir,pemasok,pembelian,stok-opname}/**`, `apps/pos-web/src/components/pos/**`.
- `apps/pos-api/src/sales/` (list filters, note), a new migration, their tests.
- One line per screen group in `ui-parity-a`'s nav config once it exists.

## Deferred (recorded, not built here)

Purchase number / date / due date / image / payment status, stock opname number and PIC, product stock and image on
cashier cards, cashier filter on history, A4 invoice, member / voucher / payment methods (U7).

## Final parity (2026-11-17)

Exercised in the browser against a local pos-api (own database), Lakasir and POS screenshots at 1280×800 in
`.evidence/ui-parity-b/` (gitignored). Screens use `@umkmall/ui` and the shell's `components/page.tsx`; extras in
`components/pos-page.tsx` (inline error, confirm dialog, date format). No legacy token classes in these routes.

| Screen | Route | State | Exercised | Not built / not exercised |
|---|---|---|---|---|
| Open shift | `/kasir` (no shift) | Done | opened with Rp100.000 | — |
| Cashier | `/kasir` (bare, no shell) | Done: grid, search, category tabs, order panel (+ / qty / − / delete), note dialog, subtotal/tax/total | added 3 items, note, 10% tax; tablet 768 px | Member and voucher rows show "Belum tersedia" until U7 wires them; product stock and image on cards |
| Payment dialog | `/kasir` | Done: method (Tunai), totals, amount field, quick amounts, "Uang pas", numpad, Bayar/Tutup, items on the right | quick amount + numpad + pay | Non-cash methods (U7) |
| Success dialog | `/kasir` | Done: change, Cetak struk, Tutup | change Rp4.400 | — |
| Receipt | `/kasir/struk/$id` | Done, shows the note | opened | Physical printer (browser print only) |
| Selling history | `/kasir/riwayat` | Done: overview cards (range), table (code, cashier, date, totals, tax, discount, cost with reports.view), date filter, pagination | filter empty day and today | Member / customer number columns (U7), cashier filter |
| Selling detail | `/kasir/riwayat/$id` | Done | opened from the table | Member details (U7), A4 invoice |
| Close shift | `/kasir/tutup` | Done | counted = expected, "Pas" | — |
| Suppliers | `/pemasok` | Done: table, search, modal form, edit/delete with confirm | create, delete | Edit opened in code review only |
| Purchases list | `/pembelian` | Done: status/date filters, table | listed | Number, date, due date, image, payment status (not in U6) |
| Purchase form | `/pembelian/baru` | Done: header grid + lines table | created 10 × Kopi Susu | — |
| Purchase detail | `/pembelian/$id` | Done: approve / cancel / delete with confirm | approved: Kopi Susu on hand 18 → 28 | cancel / delete paths |
| Stock opnames | `/stok-opname` | Done: status/date filters, table | listed | Number, PIC (not in U6) |
| Opname form / detail | `/stok-opname/baru`, `/$id` | Done | counted Es Teh 15 vs 20, approved (−5) | delete path |

## Validation and audit pass (owner requirement and code audit, 2026-11-17)

Shipped in e8a8f30 (pos-api) and 4557287 (pos-web).

- [test] Stock opname approval reads on-hand under the batch lock at approval, stores it, and applies
  `counted − on-hand now`; a draft shows today's on-hand (revert-red: 13 ≠ 15 with the old snapshot delta).
- [test] Sale `Idempotency-Key` is bound to a sha256 of the normalized request (`sales.request_hash`, migration
  0011); the same key with a different body answers 422 "Permintaan berbeda dengan transaksi sebelumnya"
  (revert-red: replayed the old sale). The cashier renews its key when the cart, note, member or voucher changes.
- [test] Purchase totals/unit costs hidden without `purchasing.manage`/`reports.view` (opname has no costs).
- [test] Stock refusals name the product and what is left ("Stok Es Teh Manis tidak cukup (sisa 2)") on
  `lines.<i>.qty`; shift state conflicts answer 409; a missing product in a body answers 422 on its field;
  purchase qty ≤ 100.000, unit cost ≤ Rp1.000.000.000, total ≤ Rp1 triliun.
- [test] `test/validation-sales-stock.e2e-spec.ts`: status and field message for missing, wrong type, out of
  range, too long, unknown key, insufficient stock, underpayment and no open shift on sales, shifts, suppliers,
  purchase orders and stock opname.
- [test] pos-web `pembelian/-validate.test.ts`: client checks mirror the zod rules with the server's field keys.
- [qa] Browser: supplier form empty → "Wajib diisi" + form error; saved → toast; purchase form with qty 0 and
  cost "1,5" → field messages per line; cashier oversell → toast and inline "Stok Keripik Singkong tidak cukup
  (sisa 20)"; merged cashier (with U7 member/voucher/method) sells with a success toast. Screenshots in
  `.evidence/ui-parity-b/pos-*`.
- Not exercised in the browser: the stale-total path (needs a price change between cart and pay; covered by the
  server's `total` in the 422), the opname approve screen after a concurrent sale (covered by the e2e test),
  network failure toasts.
- Decision: the cashier keeps one key while only the paid amount or method changes. A changed amount after a
  committed-but-timed-out try then gets the 422 above instead of a second sale being charged.
