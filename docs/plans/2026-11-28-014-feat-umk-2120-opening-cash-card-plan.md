# UMK-2120 follow-up: show and correct an automatically opened shift's opening cash

Linear: UMK-2120 (parent UMK-2119). Design 40, screen 7. Owner decision 2026-11-28 (option A): an automatically
opened shift keeps today's opening cash (the last closed shift's count), but the till shows it so the owner can
correct it.

## Decisions

- **The shift remembers that it opened by itself.** Migration: `shifts.opened_automatically` (boolean, default
  false) and `shifts.opening_checked_at` (timestamptz, null). `autoOpenShift` writes `opened_automatically = true`.
  A shift opened by hand is never shown the card. Older auto-opened shifts (before this migration) stay false; the
  audit log still marks them.
- **`GET /shifts/current`** answers `openedAutomatically` and `openingChecked` on the shift.
- **`POST /shifts/current/opening`** `{ shiftId, openingCash? }`, `sales.create`, not an agent route:
  - Locks the actor's open shift. Another shift, or none: 409 `shift_changed` (the close-day rule).
  - A shift opened by hand: 409 `opening_not_automatic`.
  - Without `openingCash` ("Sudah benar"): sets `opening_checked_at`. A repeat answers the same shift.
  - With `openingCash` ("Betulkan modal"): whole rupiah, 0 or more. Sets the opening and `opening_checked_at`, and
    writes a `shift_opening_correct` audit row (`shiftId`, `openingCashBefore`, `openingCash`) in the same
    transaction. A same-value correction is a plain check, no audit row.
  - Once checked, a correction to another amount is refused (409 `opening_checked`): after that the drawer is
    corrected with "Tambah modal laci" / a cash-out, which are recorded as movements.
  - The new opening may not leave the expected cash below zero (cash already taken out of this shift): 422
    `OPENING_TOO_LOW` on `openingCash`.
  - Answers the shift as `GET /shifts/current` does.
- **Why it is safe to change the opening.** The opening cash of an open shift is no ledger entry: the expected cash
  is opening + cash sales + movements, worked out at read time. Nothing is closed, no report changes.
- **pos-web, till** (`kasir/index.tsx`): while `openedAutomatically && !openingChecked`, a card "Shift dibuka
  otomatis", "Modal awal Rp…" (from the last count), with ActionRow "Betulkan modal" / "Sudah benar". "Betulkan
  modal" opens a dialog with the amount (Batal / Simpan). Toasts "Modal awal sudah dicek" and "Modal awal
  dibetulkan jadi Rp…". Refusals use the shared error dialog; `shift_changed` reloads.
- **Log aktivitas** shows the new event as "Modal awal dibetulkan".

## Definition of Done

- [test] `test/opening-cash.e2e-spec.ts`:
  - an auto-opened shift is marked, a hand-opened one is not;
  - "Sudah benar" checks it, a repeat is fine;
  - a correction changes the opening and the expected cash, and is audited;
  - a correction after the check is 409; a hand-opened shift is 409; another shift is 409 `shift_changed`;
  - 422 for a negative amount, and for an opening that leaves the expected cash below zero;
  - store B cannot touch store A's shift.
  - Revert-red once on the expected-cash guard.
- [test] pos-web: the card's visibility and the toast wording (`kasir/-opening.test.ts`).
- [qa] 375 px and 1280 px: the card, the correction dialog, the error dialog.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
