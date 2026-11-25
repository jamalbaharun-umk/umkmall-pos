---
title: pos-web feedback guideline (success toast, error dialog) on every screen
epic: UMK-1924
status: done (see Not covered)
---

# UI feedback guideline on every pos-web screen

## Goal

Apply the owner-approved "Panduan Dasar UI POS" (section 2 feedback, section 4 layout) to every existing pos-web
screen: each action that succeeds shows a success toast; each failure opens one error dialog that says what happened
in plain Indonesian (title "Gagal {aksi}", Apa yang terjadi, Yang bisa dilakukan, small code, buttons). Field-level
inline errors stay in addition. Nothing else is redesigned.

## Shared module

- `src/lib/describe-error.ts` (pure): `describeError(error, fallback)` maps status/code/message to
  `{ what, todo, code, primary }`. 422/400 and 409 show pos-api's own text only after a safety filter (no token,
  SQL, stack, 6+ digit run such as a PIN or phone); 401, 403, 404, 429/423, 5xx and offline use fixed text and never
  echo the server; `PIN_INVALID` has its own text.
- `src/lib/feedback.ts`: `notifySuccess(message)`, `showError(error, context)` (`context` is "menyimpan x" or
  `{ action, retry?, fallback? }`), a one-dialog store.
- `src/components/feedback-host.tsx`: the dialog, mounted once in `routes/__root.tsx` next to the `Toaster` (so bare
  routes such as `/kasir` get it too). Below `md` the `@umkmall/ui` Dialog is a bottom sheet with full-width buttons,
  main action on top; from `md` a centred card (max 448px) with the main action rightmost.
- `components/confirm.tsx` and `components/pos-page.tsx` (`act`) call the helpers; failures from a confirm dialog
  close it and open the error dialog.
- Relays (`routes/*/-api.ts`, `lib/refusal.ts`) now carry `status` (0 = no answer) so the dialog can tell a 403 from
  a 503.
- Layout: Toaster at top-centre; from 768px the toast is at most 380px wide (`styles/app.css`).

## Definition of Done

- [test] `describeError` maps 422, 403, 404, 409, 429/423, 5xx/503, offline, 401 and PIN to specific Indonesian text,
  and never echoes tokens, SQL, PINs or phone-like numbers (`src/lib/describe-error.test.ts`).
- [test] `failureOf` turns a void/PIN refusal into dialog input (`routes/kasir/-failure-of.test.ts`);
  `refusalOf` keeps the status (`lib/refusal.test.ts`).
- [cmd] `npm run lint && npm run typecheck && (cd apps/pos-web && npx vitest run) && npm run build -w pos-web`.
- [qa] Every row of the inventory below: success path shows a toast, failure path shows the dialog (offline: stop
  pos-api; 422: bad input; 403: cashier without the permission; 409: stale data; 404: deleted id).
- [qa] Phone width (under 768px): dialog is a bottom sheet, main button on top; toast top-centre. Desktop: centred
  dialog, toast at most 380px.
- [manual] Owner looks at the dialog and toast once on a phone and a desktop.

## Inventory of actions (server function, screen, success text, failure title)

| Screen | Action | Success toast | Failure dialog title |
|---|---|---|---|
| catalog/categories | saveCategory | Kategori {nama} dibuat/disimpan | Gagal membuat/menyimpan kategori |
| catalog/categories | deleteCategory | Kategori {nama} dihapus | Gagal menghapus kategori |
| catalog/products/-form | saveProduct (+ opening stock, image upload) | Produk {nama} dibuat/disimpan | Gagal membuat/menyimpan produk; Gagal mencatat stok awal atau gambar |
| catalog/products/-form | deleteImage | Gambar dihapus | Gagal menghapus gambar |
| catalog/products (list, detail) | deleteProduct | {nama} dihapus | Gagal menghapus produk |
| kasir (open shift) | openShift | Shift dibuka. Selamat berjualan! | Gagal membuka shift |
| kasir/tutup | closeShift | Shift ditutup | Gagal menutup shift |
| kasir (payment) | createSale | Pembayaran berhasil | Gagal menyimpan penjualan; Gagal melanjutkan ke pembayaran (discount) |
| kasir/-u7 | checkVoucher (apply, release, re-check) | Voucher {kode} dipakai / dilepas | Gagal memakai voucher; Gagal memeriksa voucher |
| kasir/masuk | pinSignIn | Selamat bertugas, {nama staf} | Gagal masuk |
| kasir/-void-dialog | voidSale | Struk #{no} dibatalkan | Gagal membatalkan struk |
| pengaturan/keamanan | setPin | PIN dibuat / diganti | Gagal menyimpan PIN |
| pengaturan/keamanan | unlockPin, resetPin | Kunci dibuka, PIN dihapus | Gagal membuka kunci PIN, Gagal menghapus PIN |
| pengaturan (profil) | saveProfile, uploadLogo, deleteLogo | Pengaturan toko disimpan, Logo dihapus | Gagal menyimpan pengaturan toko, Gagal mengunggah logo, Gagal menghapus logo |
| pengaturan (aplikasi) | saveAppSettings | Pengaturan aplikasi disimpan | Gagal menyimpan pengaturan aplikasi |
| pelanggan, voucher, metode-pembayaran (-ui) | saveResource, removeResource | {Objek} tersimpan/ditambahkan/dihapus | Gagal menyimpan/menghapus {objek} |
| piutang/$id | payReceivable | Pembayaran Rp... tercatat | Gagal mencatat pembayaran piutang |
| pemasok | saveSupplier, deleteSupplier | Pemasok ditambahkan/diperbarui, {nama} dihapus | Gagal menambah/menyimpan/menghapus pemasok |
| pembelian | createOrder, updateOrder, orderAction | Pembelian disimpan sebagai draf, ... | Gagal menyimpan/memproses pembelian |
| stok-opname | createOpname, opnameAction | Opname disimpan sebagai draf, disetujui, dihapus | Gagal menyimpan/menyetujui/menghapus ... |
| pengeluaran | createExpense, updateExpense, voidExpense | Pengeluaran Rp... tersimpan / dibatalkan, Perubahan ... tersimpan | Gagal menyimpan/membatalkan pengeluaran |
| staf | saveStaff, deleteStaff | Staf ditambahkan/disimpan/dihapus | Gagal menambah/menyimpan/menghapus staf |
| staf/peran | saveRole, deleteRole | Peran dibuat/disimpan/dihapus | Gagal membuat/menyimpan/menghapus peran |
| staf/perangkat | bindThisDevice, revokeDevice, revokeSession | Perangkat terhubung/dicabut, Sesi kasir diakhiri | Gagal menghubungkan/mencabut perangkat, Gagal mengakhiri sesi kasir |
| laporan | CSV download | Laporan CSV diunduh | Gagal mengunduh laporan |
| index | sign in / sign out landing | Berhasil masuk / Anda sudah keluar | (page-level alert on the sign-in screen stays) |

Client-side validation that used to show a red toast ("Periksa kembali isian Anda") now opens the dialog with the
guideline's 422 text; the field messages stay under the inputs.

## Not covered

- Icons: `nav.ts` and `components/shell.tsx` still use lucide-react. `@umkmall/ui` `Icon` has no receipt, banknote,
  piggy-bank, credit-card, package, layers, ticket, shield, list or zap glyph, so switching would change meaning;
  needs the owner's decision or new glyphs in the UI package.
- Several pages still import lucide icons for in-page actions (search, pencil, trash); same reason.
- The kasir product price-warning toasts (`saved.warnings`) stay informational warning toasts.
- Load failures (loaders) keep `PageError`; the guideline asks for it there.
- Retry buttons: dialogs only offer "Coba lagi" where a caller passes `retry`; none do yet, so the dialog shows
  "Tutup" and the form keeps its data for another press of Simpan.
