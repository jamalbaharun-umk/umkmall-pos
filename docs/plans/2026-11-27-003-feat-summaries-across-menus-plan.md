# Ringkasan lintas menu (design feature 39)

Epic UMK-1924; chart standard UMK-2074. Design: "Desain Lengkap Fase 2", feature 39 "Peninjauan semua menu".

## Goal

Every menu the design lists gets a picture summary above its list (key number first, then one chart that answers
one question; the list stays the detailed source), the cashier's finished receipt shows an optional daily target,
and Pengaturan shows a "Kelengkapan toko" board that disappears when complete. Charts come only from the merged
`@umkmall/ui` chart standard (`packages/ui/src/primitives/Charts`, primary palette). `packages/ui` is not edited.

## Owner decisions (relayed)

- The daily target is optional and set by the owner (Pengaturan). Without one, the receipt shows nothing.
- "Kelengkapan toko" hides once every step is done.
- Menus: Riwayat penjualan, Pelanggan, Produk, Kategori, Metode pembayaran, Stok opname, Voucher, Staf, Pemasok,
  Pengaturan, Struk selesai. Peran and Perangkat stay tables only; Dashboard, Laporan, Piutang, Pembelian belong to
  features 35, 37, 38 (other sessions) and are not touched.

## Design

- API `src/summaries/` (one module, read only except the target): one `GET /summaries/<menu>` per menu, each gated by
  the permission that opens that menu, tenant from the session only. Money and profit figures (cost, margin, stock
  value, revenue per category, payment method, cashier and top customer) need `reports.view` and come back `null`
  without it; the counts stay and the panels chart them instead. Sales are dated by `paid_at`,
  only `FINAL_SALE_STATUSES`; the daily total follows the report rule (sales by `paid_at` minus voids by their day);
  the per-menu shares count completed receipts only.
- `GET/PUT /summaries/daily-target`: read by `sales.create` or `reports.view`; set by the owner only (owner ruling: an
  admin holding `catalog.manage` gets 403, the form shows to the owner only). Without `reports.view` the read answers
  only whether a target is set and the percent, never a rupiah figure (a cashier sees only their own sales
  elsewhere), so the receipt card shows the percent only. Stored in
  `pos.sales_settings.daily_target` (nullable rupiah). Migration also adds `sales_settings.tax_set_at`, the board's
  "Pajak" step: `PUT /sales/settings` stamps it the first time the tax is saved, at any rate (0% = "tidak memungut pajak" counts; owner ruling via
  coordinator), and never moves it. The Aplikasi form skips the tax call when only the timezone changed, so that
  save is not a tax choice (review of PR 78).
- Web `routes/ringkasan/`: a server function per summary and one panel component per menu; a panel loads on its
  own, so a failed summary never blocks the list (error state with "Muat ulang"), shows a skeleton while loading
  and a dashed "Gambar muncul setelah ada data" box when empty. Each menu route adds one line.
- Missing from the chart standard (reported, not built): none needed so far.

## Definition of Done

- [test] each endpoint returns exact figures for a seeded store (money integer rupiah, `paid_at` dating, voids)
- [test] cross-tenant: store B never sees store A's names or figures, per endpoint
- [test] 403 without the menu's permission; cost-bearing fields null without `reports.view`
- [test] daily target: set, clear, validation 422, cashier read (percent only, no rupiah), cashier and admin cannot
  set (owner only); percent math
- [test] revert-red: the `reports.view` gate on margin/value fields, proven by breaking it
- [test] web helpers (shapes to chart data, percent, hide-when-complete) unit tested
- [qa] browser at 375 and 1024: each panel with data, empty and error
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`

## Files

API: `db/schema/sales.ts` (two columns), a migration, `src/summaries/*`, `app.module.ts` (one line),
`sales.service.ts` (stamp `tax_set_at`), `test/summaries.e2e-spec.ts`.
Web: `routes/ringkasan/*`, one line in each menu route, `routes/kasir/struk.$id.tsx`, `routes/pengaturan/index.tsx`.
