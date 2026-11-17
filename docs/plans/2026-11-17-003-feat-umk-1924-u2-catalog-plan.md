# UMK-1924 U2 — Catalog: the owner adds categories and products

Epic: [2026-11-17-001-feat-pos-epic-plan.md](2026-11-17-001-feat-pos-epic-plan.md) U2. Ported from Lakasir
(`Category`, `Product`, `Barcode`, `ProductImage`, `ProductRequest`, `ProductObserver`, `Api/Tenants/Master/*`).

## Goal

The owner manages categories and products (name, SKU, barcodes, unit, cost and selling price in integer
rupiah, type, active flag, images) through `pos-api` and `pos-web` back-office screens, each store seeing only
its own catalog. Images are stored under a per-tenant key prefix and served only through the API.

## Shape (what later units build on)

- `pos.categories`: `tenant_id`, `name` (unique per tenant). Deleting a category that still has products
  answers 409 (Lakasir 500s on the FK).
- `pos.products`: `tenant_id`, `category_id` (same tenant, checked server-side), `name`, `sku`, `unit`
  (default `PCS`), `cost_price` / `selling_price` (`rupiah()`), `type` `product | service | non_stock`,
  `is_active`, `deleted_at` (soft delete). SKU unique per tenant among live products; blank SKU is generated
  without spaces (Lakasir flaw 9). Lakasir's `initial_price` is named `cost_price` here.
- `pos.product_barcodes`: `tenant_id`, `product_id`, `code` (unique per tenant). The product payload carries
  `barcodes: string[]` (the full set; an update replaces it). A soft-deleted product's barcodes are removed so
  the codes can be reused.
- `pos.product_images`: `tenant_id`, `product_id`, `storage_key` (`tenants/<tenantId>/products/<productId>/<uuid>.<ext>`),
  `content_type`, `size_bytes`. Bytes live behind an `ObjectStorage` interface; v1 adapter is local disk
  (`POS_STORAGE_DIR`). Type is detected from the file's magic bytes (JPEG/PNG/WebP, ≤ 2 MB), never trusted from
  the client.
- **No stock here.** Quantities, batches and the `stock` read field belong to the stock module (U3/U6), which
  references `products.id`. `type` tells it which products track stock (`product` only).

## Lakasir behaviour kept / changed

- Kept: SKU auto-generated when blank, cost ≤ selling price rule, search over name/SKU/barcode, category
  filter, soft delete, `PCS` default unit.
- Changed: SKU never contains spaces; integer rupiah (no doubles); category delete in use → 409 not 500;
  bad input → 422; images never a public URL; no auto-generated barcode (SKU covers lookup); price units and
  expiry are deferred.

## REST (all owner/cashier session; tenant from the session only)

`GET/POST /catalog/categories`, `PATCH/DELETE /catalog/categories/:id`,
`GET /catalog/products?q=&categoryId=&page=&perPage=`, `POST /catalog/products`,
`GET/PATCH/DELETE /catalog/products/:id`,
`POST /catalog/products/:id/images` (multipart `file`), `GET/DELETE /catalog/products/:id/images/:imageId`.
Duplicates (category name, SKU, barcode) answer 409. Another store's id answers 404.

## Definition of Done

- [test] categories CRUD; duplicate name 409; delete in use 409.
- [test] products CRUD; search by name/SKU/barcode; category filter; pagination; soft-deleted product gone from list and GET.
- [test] SKU generated without spaces and unique; duplicate SKU 409; duplicate barcode 409.
- [test] prices: fractional, negative, string or cost > selling answers 422; values round-trip as integers.
- [test] images: upload, GET returns the bytes with the detected type, non-image refused 422, key carries the tenant prefix.
- [test] cross-tenant for every route: store B gets 404 on A's category, product and image ids (read, update, delete, upload), and B's lists exclude A's rows; B cannot attach A's category to its product (422).
- [test] slice check: "Es Teh Manis" created in store A; store B's list is empty; B's GET by A's id answers 404.
- [cmd] `npm run lint && npm run typecheck && PGTEST_DB=pos_u2 npm test && npm run build` green; CI green on `main`.
- [manual] `pos-web` screens: categories list/form, products list (search, category filter) and form, Indonesian copy, loading/empty/error states, UMKMall token styling.

## Files

`apps/pos-api/src/catalog/*` (module, controllers, service, schemas, storage), `src/db/schema/catalog.ts`
(+1 export line), `src/app.module.ts` (+1 line), `src/config.ts` (`POS_STORAGE_DIR`), one drizzle migration,
`test/catalog.e2e-spec.ts`, `apps/pos-web/src/routes/catalog/*`.

## Not in U2

Stock and its read field (U3/U6), price units, expiry, product import and label printing, image upload UI in
`pos-web` (API only in this unit), object-storage (S3) adapter, U8 purge of catalog rows and images (U8 must
cover these four tables and the `tenants/<id>/` prefix).
