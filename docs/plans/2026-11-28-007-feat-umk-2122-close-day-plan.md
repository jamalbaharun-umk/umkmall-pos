# UMK-2122: "Tutup hari" and "Tutup kemarin dulu"

Linear: UMK-2122 (parent UMK-2119). Design 41, approved 2026-11-28 with every proposed answer (WhatsApp summary on by
default). Goal: the owner who runs the store alone closes the day on one screen and decides what stays in the
drawer for tomorrow.

## Decisions

- **One close, one more field.** `POST /shifts/current/close` takes an optional `ownerTakes`: whole rupiah, 0 or
  more, never above `countedCash` (422 `OWNER_TAKES_TOO_MUCH` on `ownerTakes`). It is for the owner only: a
  cashier session that sends it gets 403. Leaving it out keeps today's close.
- **The take is bounded by the drawer and bound to the counted shift** (PR 105 review). Under the shift lock it must
  also be at most the expected cash (422 `OWNER_TAKES_TOO_MUCH`), so an over count never takes money the drawer
  should not hold; the audit's `drawerCashBefore` is never clamped. A close with a take names `shiftId` (the
  screen always sends it); a locked shift that is another one, or none, answers 409 `shift_changed` and writes
  nothing, so a repeat or a second close never closes the next shift with this count and take. The screen
  confirms before the close and reloads on `shift_changed`. The close answers `revenue` and `grossProfit`.
- **The take is a "Diambil pemilik" cash-out of the closing shift.** It is written in the close's transaction,
  under the shift lock and before the close, because a closed shift takes no entry. It writes a ledger
  `manual_out`, a `manual_cash_entries` row with reason `ambil_pemilik` and key `close-day:<shiftId>`, and a
  `drawer_cash_out` audit row with `atClose: true`.
  - The stored count and the expected cash both drop by the take, so the difference stays the count's: it is
    recorded, never hidden.
  - UMK-2120's automatic opening already uses the last closed shift's count. Tomorrow's opening is therefore what
    stayed in the drawer, with no change to the opening rule.
  - The `shift_close` audit row carries `ownerTakes`.
- **Profit never includes tax.** `GET /shifts/current` answers `revenue` and `grossProfit` (revenue − tax − cost),
  using the same definition as the reports (`metrics`). The figures count the shift's final sales minus the voids
  done in it, as the shift report does.
- **The count stays required, and a waiting sale still blocks.** The waiting-sale check runs before the take, so
  a refusal writes nothing.
- **pos-web, `/kasir/tutup` for a solo owner** (`useSolo`):
  - Step 1: the date, Penjualan, "Untung hari ini" and the count, with "Seharusnya ada" and the live difference.
    Buttons: Batal / Lanjut.
  - Step 2: "Simpan di laci" or "Diambil pemilik" as chips, with the amount taken, "Tinggal di laci untuk besok",
    and the switch "Kirim ringkasan ke WhatsApp" (on by default). Buttons: Kembali / Tutup hari.
  - Result: "Hari ditutup", the drawer difference and tomorrow's opening. Buttons: "Kirim ke WhatsApp" (a wa.me
    link, figures only), or "Lihat ringkasan" when the switch is off; then Selesai.
  - Toast: "Hari ditutup. Selisih laci Rp0". Refusals use the shared error dialog. A waiting sale lists the sales,
    as the shift close does.
  - Every other actor keeps "Tutup shift" unchanged.
- **"Tutup kemarin dulu".** The till shows it to a solo owner whose open shift began on an earlier store day
  (Asia/Jakarta, the day hold numbers use). It names that day and its sales. "Nanti saja" hides it for that shift
  in this tab; it is kept in memory only, because the till keeps browser storage to the pending-sale store.
- **The WhatsApp summary goes through a wa.me link**, not the UMKMall agent, because the WhatsApp API is deferred
  (decision 2026-11-26). It holds no PIN, token or customer name.
- **Not here:**
  - The auto-opened shift's "Modal awal" card (design 40, screen 7, decided 2026-11-28) is the next unit.
  - Closed days stay unchanged; corrections use reversal lines.

## Definition of Done

- [test] `test/close-day.e2e-spec.ts`:
  - shift profit without tax;
  - the take is recorded and audited, and lowers the next automatic opening;
  - a short count keeps its difference;
  - a close without a take, and a day without sales;
  - 422 for a take above the count, a missing count and a negative take, leaving the shift open;
  - 422 for a take above the expected cash when the count is over; a take without `shiftId` is 422;
  - 409 `shift_changed` for a repeat after a new shift opened, a repeat with none open, two closes at once;
  - profit after a line discount and less a void;
  - a waiting sale still refuses and writes no take;
  - a cashier's take gets 403;
  - store B touches nothing of store A.
  - Revert-red proven once by storing the count without the take, and once each for the expected-cash bound and
    the shift binding.
- [test] pos-web `kasir/-close-day.test.ts`: store day, the earlier-day check, the take check, the difference
  wording and toast, the summary text and link.
- [qa] 375 px and 1280 px: the till offer, the two steps, a take above the count (error dialog), the result and the
  WhatsApp link.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
