# fix(web): scan beep in Pengaturan, audio unlock on mobile (UMK-1986, design 47)

Follow-up of [2026-11-28-012](2026-11-28-012-feat-umk-1986-camera-barcode-scan-plan.md). pos-web only.

## Goal

Design 47 puts the "Bunyi scan" switch in Pengaturan. Today it lives only in the camera sheet. The beep must also play
on a phone, where an AudioContext starts `suspended` until a user gesture resumes it.

## Definition of Done

- [test] `setBeep` / `subscribeBeep` notify listeners in the same tab and on the `storage` event of `pos.scan.beep`;
  they never throw without a window or when storage or dispatch fails.
- [test] `audioAction` creates a missing or closed context and resumes a `suspended` or `interrupted` one.
- [cmd] `npx vitest run` and `npx tsc --noEmit` in `apps/pos-web` pass.
- [manual] Pengaturan, tab Aplikasi, shows "Bunyi scan" with "disimpan di perangkat ini"; changing it changes the
  switch in the camera sheet and the other way round. Not exercised in a browser by the author.

## Decisions

1. Per-device preference in `localStorage` (existing key and helpers), not a server setting. It saves on change, like
   the "Teks besar" switch of Panduan: no toast.
2. One hook, `useBeepSetting` (`components/barcode-scanner.tsx`), used by the sheet and Pengaturan. Sync inside a tab by
   a `pos:scan-beep` window event, across tabs by `storage`.
3. `primeBeep()` creates or resumes the shared AudioContext; it is called from the Scan button clicks (till, product
   form), the sheet's open effect and when the switch is turned on. `beep()` asks again; `resume()` rejections are caught.
4. No guide target: the switch sits on the Aplikasi tab, which is hidden when the guide starts, so a coach mark there
   could point at nothing. `guides.ts` is unchanged.

## Files

`lib/barcode-scan.ts` (+ test), `components/barcode-scanner.tsx`, `routes/pengaturan/index.tsx`,
`routes/kasir/index.tsx`, `routes/catalog/products/-form.tsx`.
