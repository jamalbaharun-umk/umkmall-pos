# feat(web): scan barcodes with the camera (UMK-1986, design 47)

Epic UMK-1924, issue UMK-1986. pos-web only: no new server route, no dependency.
Design: "Desain Fase 3", feature 47 (approved by the owner 2026-11-28).

## Goal

The cashier adds a product to the cart by pointing the phone or laptop camera at its barcode; the owner fills a
barcode field of the product form the same way. A typed code or a USB scanner keeps working.

## Decisions

1. **Native `BarcodeDetector` only; no library fallback in this unit.** Chromium (Android, desktop) has it; Safari
   (iOS) does not. A fallback (for example a zxing WebAssembly build) is a new dependency of several hundred KB and
   needs the owner's word on the iOS audience, so it is left out: where the browser cannot read barcodes the Scan
   button is not shown and the typed code stays. The detector sits behind one function in `components/barcode-scanner.tsx`,
   so a library can be added there later without touching the screens.
2. **Same code twice within 1.5 s counts once** (owner ruling): measured from the last accepted scan of that code, so
   holding the camera on one item adds one, and one more after 1.5 s. Typed codes are never deduplicated.
3. **Success beep on by default, switchable** (owner ruling): a "Bunyi" switch in the camera sheet, kept per device in
   `localStorage` (`pos.scan.beep`), every access in try/catch; without storage it is on and the page works.
4. **Matching a code to a product uses the existing `GET /catalog/products?q=`** (name, SKU or barcode, tenant from the
   session, already covered by the cross-tenant test in `test/catalog.e2e-spec.ts`). The search is a substring match, so
   the browser keeps only the product whose barcode equals the code. No server change. An unknown code is a normal
   state (screen 4/5), never an error.
5. **Where:** the till (Scan button next to the search field, `data-guide="kasir-scan"`), and the Barcode fields of the
   product form. Stock-in (Pembelian) and Stok opname pickers are not in the design and stay as they are.
6. **Hardware scanner at the till:** the till's grid search matched only name and SKU. Enter in the search field now
   looks the typed text up as a barcode when nothing in the grid matches it.
7. **Camera hygiene:** the stream is stopped when the sheet closes and on unmount; nothing is recorded or uploaded;
   permission denied, no camera, an insecure (http) address and a camera in use each have their own state with the
   typed-code fallback.
8. **Unknown code at the till:** "Tambah sebagai produk cepat" opens the UMK-2130 quick product dialog with the barcode
   filled, only for a holder of `catalog.manage`; others see "Anda tidak boleh menambah produk".
9. A product with several units is added in its base unit by a scan (the unit picker is not stacked on the camera).
10. The Kasir guide keeps 5 steps: the "Lihat total" step is folded into the payment step to make room for "Scan".

## Definition of Done

- [test] `lib/barcode-scan.test.ts`: dedupe window (1.5 s edge, other code, A-B-A, forget), code normalisation, beep
  preference (default on, storage missing or throwing), camera support and error classification, format picking,
  exact barcode match, the till's and the form's result texts.
- [test] `guides.test.ts` and `action-row.guard.test.ts` stay green (new target `kasir-scan`, ActionRow groups).
- [cmd] `npx vitest run` and `npx tsc --noEmit` in `apps/pos-web`.
- [qa] Fake-camera Chromium: the sheet opens on Scan, shows the camera, closes on "Selesai" and the camera tracks end.
- [manual] A real phone camera over https: scan adds to the cart, the beep, unknown code, denied permission. Not
  possible in the build sandbox.
