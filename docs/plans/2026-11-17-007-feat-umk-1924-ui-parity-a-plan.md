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

- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green (`PGTEST_DB=pos_uipa`).
- [test] `/tenant/me` returns the cashier's name and permissions, the owner's full permission set; store B's
  session never sees store A's staff name.
- [test] nav config: an entry whose route does not exist or whose permission is missing is hidden (pure function).
- [qa] each screen above opened in the browser against a local pos-api, every action exercised (create, edit,
  delete, search, filter, paginate, upload, bind, revoke, PIN sign-in), screenshots of Lakasir and POS at
  1280×800 in `.evidence/ui-parity-a/` (gitignored), tablet width (768) checked.
- [manual] parity table below filled with the final state per screen; UMK-1924 comment lists screens and what
  was not exercised.
- [cmd] legacy token classes removed from `app.css` only when `grep` finds no screen using them.

## Files

`apps/pos-web/src/nav.ts`, `apps/pos-web/src/components/` (shell, shared page pieces), `routes/__root.tsx`,
`routes/index.tsx`, `routes/catalog/**`, `routes/staf/**`, `routes/kasir/masuk.tsx`, `apps/pos-api/src/tenancy/`
(+ test), CLAUDE.md (nav config note).

## Final parity (filled at the end)

_pending_
