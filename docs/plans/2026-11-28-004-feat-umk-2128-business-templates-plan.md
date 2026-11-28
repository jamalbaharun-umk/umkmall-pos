# UMK-2128: business templates, "Usaha Anda apa?" and "Isi harga"

Linear: UMK-2128. Design 44, screens 1 to 3 (owner approved 2026-11-28). Goal: a new store's first receipt in five
minutes without help.

## Decisions

- Seven templates from the BD research segments (`src/onboarding/templates.ts`): Warung makan (24), Warung kelontong
  (30), Kafe dan minuman (22), Kue dan roti (20), Fashion dan aksesoris, ATK dan fotokopi, Jasa salon dan laundry.
  Each has categories, units and 20 to 30 sample products. Food, retail and ATK products are `non_stock` so the first
  receipt needs no stock-in; the services template uses `service`. Switching a product to tracked stock is the
  product form's job.
- Template products have no price: written at Rp0 and **inactive**, so the till never shows them and a sale refuses
  them (the till already sells active products only). "Isi harga" sets the price and makes the product active.
- Applying a template also adds Tunai (cash) and "QRIS toko" (`wallet`, CASHAC `static_qris`), found before made
  (name unique per store, ignoring case), and records tax 0% only when the store has not chosen a tax yet
  (`tax_set_at` null). A tax already chosen is left as it is.
- Applying twice adds nothing twice: a product name the store already has (ignoring case) is skipped.
- Routes, all behind `catalog.manage`, not agent routes: `GET /onboarding/templates`,
  `POST /onboarding/templates/:key/apply` (unknown key 404), `GET /onboarding/unpriced`, `POST /onboarding/prices`
  `{ items: [{ id, sellingPrice }] }` (1 to 200, whole rupiah above 0, no duplicate id; 422 otherwise). Prices go
  through `CatalogService.updateProduct`, so the usual cost and tier rules apply; a product that is not waiting for a
  price (another store's, already priced, unknown) is reported per row, never changed.
- "Kelengkapan toko": the Produk step counts a sellable product (active, price above 0, not an ingredient), so
  unpriced template products leave it open; its link is `/mulai` without products, `/mulai/harga` with unpriced ones.
- pos-web: `/mulai` (three one-tap starts; "Mulai dari HPP" opens the recipe screen once it exists, else a new
  product), `/mulai/template` (single choice, "Pakai template X", toast "Toko siap: 24 produk ditambahkan"),
  `/mulai/harga` (prices by category, "Mulai jualan" saves and opens the till, "Isi sekarang" goes to the first empty
  field). The dashboard of a store without products offers "Mulai siapkan toko", and any store with unpriced products
  gets a warning with "Isi harga".
- PR 91 review minor: an import row whose product was made but whose opening stock failed is reported as saved with a
  note (`saved: true`), never as "tidak disimpan". The five-word "Simpan n baris yang benar" is design 44's approved
  copy and stays.

## Definition of Done

- [test] `src/onboarding/templates.spec.ts`: seven templates, 20 to 30 products each, unique names and categories,
  counts as in design 44.
- [test] `test/onboarding-templates.e2e-spec.ts`: apply makes categories, inactive Rp0 products, Tunai and QRIS toko,
  tax 0%; an unpriced product cannot be sold; a second apply adds nothing and keeps a chosen tax; prices put products
  on sale and report rows they cannot save; 422 and 404; 403 without `catalog.manage`; store B neither sees nor prices
  A's products.
- [test] `test/summaries.e2e-spec.ts`: the Produk step links to `/mulai` in an empty store.
- [test] `test/product-import.e2e-spec.ts`: a failed opening stock is reported as saved with a note.
- [test] pos-web `-onboarding.test.ts`, `-import.test.ts`.
- [qa] 375 px and 1280 px: dashboard → Mulai → template → toast → Isi harga → Mulai jualan → the priced products on the
  till.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
