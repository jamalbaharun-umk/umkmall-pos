# UMK-2129: product import from CSV with a preview

Linear: UMK-2129. Design 44, screen 4 (owner approved 2026-11-28). For owners moving from Moka, Majoo or Excel, or
with a long price list.

## Decisions

- The screen reads the file and sends its text; pos-api parses and checks it (`src/catalog/import.ts`, pure, unit
  tested) and adds the checks that need the store (`ImportService`). Two routes behind `catalog.manage`:
  `POST /catalog/products/import/preview` (rows with their errors, nothing saved) and `POST /catalog/products/import`
  (reads the file again, saves the rows that pass). Body `{ csv }`, at most 400 000 characters; the JSON limit of
  these two routes is 2 MB (`http.ts`), every other route keeps 100 kB.
- CSV: RFC 4180 quotes, BOM stripped, delimiter from the header line (`;` from an Indonesian Excel, `,`, tab).
  Headers in Indonesian or English (Moka/Majoo style): Nama, Harga jual, Harga modal, SKU, Kategori, Satuan,
  Barcode, Stok. Nama and Harga jual are required columns, else the whole file is refused (422 `CSV_INVALID`), as is
  an empty file or one over 500 product rows.
- Money: "68000", "68.000", "68,000", "Rp 68.000", "68.000,00" are whole rupiah; anything else ("abc", "1,5") is a
  row error. Never a float.
- Row errors, in Indonesian and per row: name, price, cost above price, SKU/barcode format, stock not a whole number;
  a SKU, barcode or name repeated in the file (the first row keeps it); a SKU, barcode or name already in the store.
  Nothing is overwritten. A second import of the same file saves nothing twice (every name is taken).
- Categories by name ignoring case, made when missing (first spelling in the file); no category → "Lainnya".
- A `Stok` cell (even 0) makes a stock-tracked product with that opening stock; no stock cell → `non_stock`, so it
  sells at once (the owner's "sell first" ruling).
- Excel (.xlsx) is not read directly: the screen says to save it as CSV (no new dependency). Open to the owner.
- PR 88 review minors: `cost=missing` is ignored for an actor who may not see costs; the quick product dialog sends
  once per press (a ref guard).

## Definition of Done

- [test] Parser and row checks (`src/catalog/import.spec.ts`): money forms, quotes and delimiters, per-row errors,
  in-file duplicates, missing columns, empty, 500/501 rows, English headers.
- [test] `test/product-import.e2e-spec.ts`: preview saves nothing and marks store duplicates; import saves only the
  passing rows (integer rupiah, categories once, stock only with a stock cell, existing product untouched); the same
  file again creates nothing; 422 `CSV_INVALID` and bad bodies; 403 for a cashier; store B is not affected by A.
- [test] `test/quick-product.e2e-spec.ts`: a cashier's `cost=missing` lists every product.
- [test] pos-web `-import.test.ts`: file checks, labels, summary, toast, sample header.
- [qa] 375 px and 1280 px: pick a CSV → preview with per-row notes → "Simpan 2 baris yang benar" → toast and the rows
  not saved; the same file again shows every row taken.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
