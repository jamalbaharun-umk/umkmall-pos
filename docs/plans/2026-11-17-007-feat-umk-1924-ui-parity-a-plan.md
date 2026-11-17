# UMK-1924 UI parity A: app shell, dashboard, sign-in, catalog, staff

## Goal

Every screen in this slice looks and works like its Lakasir counterpart (layout, fields, flow), built from
`@umkmall/ui` (`packages/ui`, vendored) on the UMKMall admin dashboard theme (`apps/pos-web/src/styles/app.css`),
and every action works end to end against pos-api. Owner decision 2026-11-17 (CLAUDE.md, UI rule).

Sibling sessions: `ui-parity-b` (cashier, sales history, shift, receipt, suppliers, purchasing, stock opname),
`u5-reports` (`/laporan/*`, dashboard widgets), `u7-members` (`/pelanggan`, `/voucher`, `/metode-pembayaran`,
`/piutang`). They add one line each to the central nav config this slice creates.

## The shell

- `apps/pos-web/src/nav.ts`: the ONE nav config. Groups and entries in Lakasir's order
  (`TenantPanelProvider::getNavigationItems/Groups`): ungrouped Dashboard, Kasir, Riwayat penjualan, Supplier,
  Pelanggan (Member), Metode pembayaran, Piutang; **Inventori**: Pembelian, Stok opname, Produk, Kategori;
  **Pengguna**: Staf, Peran, Perangkat; Laporan; Voucher; **Pengaturan**. Each entry `{ to, label, icon, permission? }`.
  An entry renders only when its route exists in the route tree and the actor holds its permission.
- Mounted once in `__root.tsx`: signed in → `AppShell` with `Sidebar` (rail on tablet/desktop, drawer on narrow
  widths) + a top bar (`Header`) with store name and the signed-in actor; signed out → the bare page. Paths that
  are full-screen in Lakasir too (the POS screen, the PIN screen, the printable receipt) are listed in
  `BARE_PATHS` in the same file and render without the shell.
- `/tenant/me` gains `actor.name` (cashier: staff name; owner: null) and `actor.permissions` so the shell can show
  who is signed in and hide what they may not open. Cross-tenant: unchanged query on the session tenant only.

## Screen-by-screen

| Lakasir screen | POS route | `@umkmall/ui` components | Gaps / notes |
|---|---|---|---|
| Panel layout (sidebar groups, top bar) | `__root.tsx` + `nav.ts` | `AppShell`, `Sidebar`, `SidebarMenuItem`, `Header`, `Menu` (actor menu) | No store name in POS yet (Lakasir: General Setting); shows "Toko kamu" until a settings unit stores one. No global search (Lakasir's top search). |
| Login (`/member/login`) | `/` signed out | `Card`, `Button`, `Alert` | Deliberate: POS owners sign in through UMKMall (U1), not email/password. "Masuk (pengembangan)" stays for local work. |
| Dashboard | `/` signed in | `Card`, `Button` | Metric widgets (revenue/sales/discount today, best sellers, expired) are U5's `MetricWidgets`, added with one line. Until then: page title + onboarding card. |
| Products list | `/catalog/products` | `Table`, `TextField` (search), `Select` (category filter), `Pagination`, `Badge`, `Menu` (row actions), `Button` | Columns like Lakasir: kategori, nama, SKU, stok, satuan, harga modal, harga jual, laba, jenis, status. Stock column needs on-hand per product in the list (check pos-api). No bulk delete, no column toggle, no trashed filter (POS has no soft delete UI). |
| Product create/edit | `/catalog/products/baru`, `/catalog/products/$id/ubah` | `Upload` (images), `TextField`, `Select`, `CheckBox`, `Button` | Fields: gambar, nama, barcode (repeater), SKU (blank = auto), kategori, satuan, harga modal, harga jual, jenis, aktif. Lakasir's opening "Stock" field: POS sets opening stock through `POST /stock/opening` after create (check). |
| Product view | `/catalog/products/$id` | `Card`, `Badge`, `Tabs`, `Button`, `Menu` | Stat cards (stok; terjual/omzet/diskon need U5 data → only stock), detail grid, stock history tab if pos-api exposes movements. |
| Categories | `/catalog/categories` | `Table`, `TextField` (search), `Dialog` (create/edit modal), `Button` | Lakasir edits in a modal on the list; same here. |
| Users | `/staf`, `/staf/baru`, `/staf/$id` | `Table`, `Badge`, `TextField`, `CheckBox`, `Button` | Deliberate: POS staff sign in with a PIN on a bound device (U4), so fields are nama, PIN, peran, aktif — no email/password/phone/address. |
| Roles | `/staf/peran`, `/staf/peran/baru`, `/staf/peran/$id` | `Table`, `TextField`, `CheckBox` (permission grid, select all), `Button` | POS has 6 permission keys (U4) instead of Lakasir's ~80. Lakasir's separate Permission list page is folded into the role form (read-only list in Lakasir). |
| (none, POS-only) Devices | `/staf/perangkat` | `Card`, `Table`, `TextField`, `Button`, `Badge` | U4 device binding and live cashier sessions; no Lakasir counterpart. |
| (none, POS-only) Cashier PIN | `/kasir/masuk` | `Card`, `Button` | Full-screen, no shell. |

## Definition of Done

- [x] [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green (`PGTEST_DB=pos_uipa`).
- [x] [test] `/tenant/me` returns the cashier's name and permissions, the owner's full permission set; store B's
  session never sees store A's staff name.
- [x] [test] nav config: an entry whose route does not exist or whose permission is missing is hidden (pure function).
- [x] [qa] each screen above opened in the browser against a local pos-api, every action exercised (create, edit,
  delete, search, filter, paginate, upload, bind, revoke, PIN sign-in), screenshots of Lakasir and POS at
  1280×800 in `.evidence/ui-parity-a/` (gitignored), tablet width (768) checked.
- [x] [manual] parity table below filled with the final state per screen; UMK-1924 comment lists screens and what
  was not exercised.
- [x] [cmd] legacy token classes removed from `app.css` once `grep` found no screen using them (after u5's 3ed4996).
- [x] [test] stock on-hand and movement history endpoints: own tracked products only, 404 for another store.

## Files

`apps/pos-web/src/nav.ts`, `apps/pos-web/src/components/` (shell, shared page pieces), `routes/__root.tsx`,
`routes/index.tsx`, `routes/catalog/**`, `routes/staf/**`, `routes/kasir/masuk.tsx`, `apps/pos-api/src/tenancy/`
(+ test), CLAUDE.md (nav config note).

## Final parity (2026-11-17)

Exercised in the browser at 1280×800 against a local pos-api (own db `pos_uipa_dev`), tablet (768) and phone (375)
spot-checked; Lakasir and POS screenshots in `.evidence/ui-parity-a/` (gitignored).

| Screen | State | Exercised | Deliberate differences (why) |
|---|---|---|---|
| Shell | **Matches**: grouped left nav in Lakasir's order, active entry, collapse control, store name top-left, actor menu top-right | owner and cashier (nav filtered by permission, cashier name shown), sign-out, phone drawer, not-found page | No global search or notification bell (no POS feature behind them). Store name reads "Toko kamu" until a settings unit stores one. Nav also lists Perangkat (POS-only). |
| Sign-in (`/`) | Centred card like Lakasir's login | dev sign-in, failure alert path | Owners arrive from UMKMall (U1), so no email/password form; "Masuk sebagai kasir (PIN)" link added. |
| Dashboard | Title + U5 `MetricWidgets` (revenue, sales, profit by period) + start card | loading/empty/error of the widgets (error seen until migrations ran) | Lakasir's expired-product and best-seller widgets belong to U5's widget set. |
| Products list | **Matches** columns (kategori, nama, SKU, stok, satuan, harga modal, harga jual, laba, jenis, status), search by SKU/name/barcode, filter, row actions menu, pages | search (barcode), category filter, page 2, row view/edit/delete with confirm | Filter is a category select (Lakasir: status/expired/trashed filters); no bulk delete or column toggle; 10 per page fixed. |
| Product create/edit | **Matches** fields and order: images, nama, barcode repeater, SKU (blank = auto), kategori, stok (create only), satuan, harga modal/jual, jenis, aktif; Simpan / Simpan & buat lagi / Batal | create with image + barcode + opening stock 10 → SKU `MIN-EST-0001`, edit price, image shown through the pos-web proxy | Lakasir's "Non stock" checkbox is the Jenis select's "Tanpa stok" value. No inline "create category" button on the select. |
| Product view | **Matches**: status badge, Ubah, more-actions menu (Hapus), stat cards, detail grid, history tabs | opened after create/edit; history shows the opening stock movement | Stat cards show stock and prices instead of sold/revenue/discount (U5 data); tabs are Riwayat stok + Batch stok (Lakasir: stock/selling history, price units — POS has no price units). |
| Categories | **Matches** list (search, name, Ubah/Hapus) | create, edit, delete (confirm), search | Create/edit in a modal instead of a separate page (one field). |
| Staff (Lakasir Users) | **Matches** list + create/edit page layout, Delete on the edit page | create (PIN + confirm, role), edit (second role via multi-select), delete confirm path | Name, PIN and roles instead of email/password/phone/address: POS staff sign in by PIN on a bound device (U4). |
| Roles | **Matches**: list, form with name + searchable permission checkbox grid + select all, Delete on edit | create, edit permissions (count updates) | POS has 9 permission keys (Lakasir ~80); Lakasir's read-only Permission page is folded into the role form. |
| Devices (POS-only) | Panels + tables | bind this browser, live session listed, "Keluarkan" ends it | No Lakasir counterpart (U4). |
| Cashier PIN (POS-only) | Full-screen card, staff picker, keypad | wrong PIN error, correct PIN via keyboard → `/kasir`, shell shows the cashier | No Lakasir counterpart (U4). |

Not exercised: device "Cabut" (same confirm path as Keluarkan, not clicked), the PIN lockout countdown (429), image
over 2 MB refusal, product delete from the view page (deleted from the list instead). `app.css`'s legacy token block
is gone (no screen used it after u5's 3ed4996).

## Validation and audit pass (owner requirement 2026-11-17)

- [x] [test] `common/error.filter.ts` (global): every refusal is `{ message, errors? }` in Indonesian; Nest defaults,
  unknown routes, bad JSON (400), oversize upload (422 on `file`), Postgres 23505/23503/22P02 and unknown errors (safe
  500, logged without values) — `error.filter.spec.ts`, `validation-catalog-staff.e2e-spec.ts`.
- [x] [test] catalog, staff, roles, devices, auth on `common/validation.ts` with specific messages; 409 field errors for
  duplicate SKU, barcode, category, role and staff names (staff names unique per store, case-insensitive).
- [x] [test] cost price hidden without catalog.manage / reports.view / purchasing.manage (revert-red proven); unknown
  UMKMall user on exchange → 401; non-UUID device header → 401; category delete race → 409.
- [x] [test] web: `lib/validate.ts` mirrors the zod rules, `lib/refusal.ts` maps server field errors, `lib/sign-in.ts`
  routes an expired cashier to `/kasir/masuk` and explains failed sign-ins.
- [x] [qa] browser: product form empty / bad values / duplicate SKU, category empty / duplicate / in use, staff empty /
  duplicate name, sign-in toast — screenshots `validation-*.jpg` in `.evidence/ui-parity-a/`.
- Not exercised in the browser: UMKMall outage on refresh (no UMKMall locally; covered by code path only), cashier
  expiry redirect (needs a 15-min-old cashier token), role/device empty submits (same helper as category, API-tested).
  Staff-name uniqueness is a read-then-write check (`shortcut:` comment); a partial unique index belongs to the next
  staff migration.
