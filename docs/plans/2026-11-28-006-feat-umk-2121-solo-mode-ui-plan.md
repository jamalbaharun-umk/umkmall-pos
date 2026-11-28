# UMK-2121: solo-owner mode in the screens

Linear: UMK-2121. Design 40 (owner approved 2026-11-26/28). Goal: an owner who runs the store alone sees a POS without
team machinery, and never needs a second person's PIN.

## Decisions

- Solo mode is worked out, never switched: `isSoloOwner` (owner session, no active non-deleted staff). `/tenant/me`
  answers `solo` for an owner session (`null` for a cashier): `active`, `storeCash` (Kas toko still holds cash),
  `ownerPin` (the owner has a PIN), `freshSignIn` (the session may still make the first PIN).
- Menu (`nav.ts`): an entry marked `team: true` hides while solo (Setoran, Staf, Peran, Perangkat, Log aktivitas);
  Kas toko (`team: 'storeCash'`) hides only while solo AND empty, so money already there is never out of reach. The
  shell shows "Anda menjalankan toko sendiri" in the menu. Routes stay reachable by URL; only the menu changes.
- Pengaturan gets "Status toko" (Sendiri / Dengan staf, "Dihitung dari data staf; tidak ada saklar.", "Tambah staf").
  Keamanan links Log aktivitas for the owner, since the menu hides it in solo mode.
- "Buat PIN pemilik" opens on the dashboard right after sign-in (`/?masuk=1`) when the owner has no PIN and the sign-in
  is fresh. "Nanti saja" says a PIN made later needs a new WhatsApp sign-in (UMK-2054 rule, unchanged). Success toast
  "PIN pemilik tersimpan"; a refusal uses the PIN error words of Keamanan.
- "Kasir" is hidden in sales history (list, detail), shift history and the sales and cashier report tables while solo,
  but only when every name shown is the owner's ("Pemilik"): a former cashier, the agent or a helper keeps the
  column. CSV and PDF keep every column.
- Till: `GET /shifts/current`'s `discountPinRequired` (PR 94) reaches the discount dialog and the line check. False:
  a reduction above 30% applies without the PIN step, with the hint "Anda menjalankan toko sendiri…". The server
  decides again at every sale; an absent flag (older pos-api) keeps the PIN.
- Auto-opening cash (PR 90 question) is untouched here.

## Definition of Done

- [test] `test/tenancy.e2e-spec.ts`: `solo` flags for an owner (no staff, PIN, store cash), a cashier ends solo mode,
  a cashier gets `null`, store B sees its own state.
- [test] pos-web `nav.test.ts` (team entries, Kas toko with and without cash), `lib/owner-pin.test.ts`,
  `lib/solo.test.ts`, `laporan/-reports.test.ts` (`soloReport`), `kasir/-discount.test.ts` (no PIN problem, hint).
- [qa] 375 px and 1280 px: menu and notice, Status toko, PIN prompt after sign-in, history without Kasir, 50% discount
  without PIN.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
