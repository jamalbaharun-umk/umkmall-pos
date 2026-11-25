# U4 / UMK-1992: store static QRIS

## Goal

A store uploads its own static QRIS image once (Pengaturan). The cashier's wallet payment step shows that image
to the customer, and a store without one sees "QRIS belum diatur" with a link to settings. Approved design:
"Desain P0", feature 5 (QRIS statis di layar, QRIS belum diatur). No payment gateway; "Sudah diterima" is the
existing wallet (`static_qris`) sale.

## Decisions

- Reuse the store profile logo pattern exactly: two columns on `pos.store_profiles` (`qris_key`,
  `qris_content_type`), migration `0029_store_qris`. No new table, so RLS, tenant FK and the purge's runtime
  table discovery are already covered.
- Routes next to the logo: `POST|GET|DELETE /store/profile/qris`. Upload and delete need `catalog.manage` (as the
  logo); GET is open to every signed-in session of the store (as the logo), so `sales.create` holders can fetch it.
- `GET /store/profile` gains `qrisConfigured: boolean`; the cashier loader reads it.
- Image checked with `detectImage` (JPG, PNG, WebP), at most 2 MB, stored at
  `tenants/<tenantId>/store/qris-<uuid>.<ext>`; a replaced file is deleted; the purge's prefix delete takes it.
- Like the logo, an upload needs a saved profile row first (409 otherwise).

## Definition of Done

- [test] Upload then GET returns the same bytes with `image/png` and `nosniff`; `qrisConfigured` flips true.
- [test] Replace leaves exactly one `qris-*` file, a different one; delete answers 204, GET 404, file gone.
- [test] Non-image, over 2 MB and a missing file answer 422 `file`; no saved profile answers 409.
- [test] Cross-tenant: store B gets 404 on GET and DELETE of A's QRIS, sees `qrisConfigured: false`, and B's own
  upload and delete leave A's QRIS intact.
- [test] A `sales.create` cashier reads the flag and the image (200) but gets 403 on POST and DELETE.
- [test] Purge erases the QRIS file with the store's other images and leaves store B's (`purge.e2e-spec.ts`).
- [test] Revert-red once: remove the delete permission and the purge's prefix delete, both tests go red, restore.
- [test] pos-web: `payStepOf` helper (`-pay-step.ts`) picks QR / not-configured / none by method kind and flag.
- [cmd] `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=pos_qris npx jest --runInBand` in
  apps/pos-api (the purge chmod test fails only as root); `npx vitest run` in apps/pos-web.
- [qa] Settings, Pembayaran tab: no profile, empty, uploaded preview, replace, remove (confirm), error.
- [qa] Cashier wallet method: QR image with the amount due, load-failure text, "QRIS belum diatur" with link.
- [manual] Not run without a browser: upload in the real UI and scan the shown QR with a phone.

## Files

- `apps/pos-api/src/db/schema/store.ts`, `drizzle/0029_store_qris.sql` (+ meta)
- `apps/pos-api/src/store/store.controller.ts`
- `apps/pos-api/test/store.e2e-spec.ts`, `test/purge.e2e-spec.ts`
- `apps/pos-web/src/routes/pengaturan/qris.ts` (image proxy), `-api.ts`, `index.tsx` (Pembayaran tab)
- `apps/pos-web/src/routes/kasir/-pay-step.ts`, `-pay-step.test.ts`, `-api.ts`, `index.tsx` (PayDialog)
