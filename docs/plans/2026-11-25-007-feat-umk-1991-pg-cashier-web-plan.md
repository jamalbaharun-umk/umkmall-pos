# UMK-1991: the cashier's PG screens in pos-web

Date: 2026-11-25. Epic UMK-1924, payment-api UMK-1991. Builds on
[2026-11-25-006](2026-11-25-006-feat-umk-1991-pg-cashier-flow-plan.md) (the server, merged: the routes and shapes are
there) and the approved UI guideline "Panduan Dasar UI POS" (success toast, error dialog, mobile and desktop).

## Goal

A cashier can sell with an online method (dynamic QRIS or VA) from pos-web against the local fake gateway: choose it in
the pay dialog, show the QR or VA number with a 15-minute countdown, wait while the screen polls, and finish by paid,
cash, cancel or the server's own expiry. A paid online sale is refunded (not voided) from the sale page, with the
refund's status, a retry and the owner's manual mark. The owner can create an online payment method. Sale dates show
`paidAt`.

## Decisions

- **Screens, not a new route.** The waiting screen is a dialog (`OnlineWait`) over the cashier, because an
  `awaiting_payment` sale is in no list. It cannot be dismissed while the payment is open; it ends by payment, cash,
  cancel or pos-api's expiry. The id of the waiting sale is kept per tab (like the open bill) so a reload shows the
  screen again (`useResumeOnlineSale`); nothing is shown for a sale that ended or is not the actor's.
- **pos-api owns every status.** The screen polls `GET /sales/:id/payment` every 3 s (one request at a time, none during
  an action, an older answer never overwrites a newer one). The countdown is display only: `checkoutExpired` with the
  payment still open says "waiting for the gateway", never "expired". Cancelled sales keep the cart, with a new
  Idempotency-Key (the old key would answer the cancelled sale again).
- **503 has two meanings on the switch to cash.** `payment_unavailable` = nothing happened (check the status first, the
  bill may be closed); `cash_payment_pending` = the sale IS cash, the cashier repeats "Simpan tunai lagi" and can no
  longer go back. A POST /sales that answers 503 with a `saleId` repeats with the same key, never a second sale.
- **Error mapping** is `PAYMENT_CODES` in `lib/describe-error.ts` (lower-case stable codes of 409/503, upper-cased as
  the help code); 401/403/404/422/429 keep their strict wording. The server's long text is never used for them.
- **The cashier is offered an online method only while the store may charge it** (`GET /online-payments/methods`); the
  dialog says how many were left out.
- **Refund** reuses the void dialog (`online` prop: refund route, same reasons, same PIN approver). The void card shows
  `RefundPanel`: pending / succeeded / refused, "Ajukan refund lagi" (`sales.void`), "Tandai dikembalikan manual" (the
  owner only, with a note).
- **Dates:** the sales list, the sale page and the receipt show `paidAt` (from `GET /sales/:id`; the receipt endpoint
  does not carry it), falling back to `createdAt`.
- **QR rendering:** the repo had no QR generator (the store QRIS is an uploaded image). Added the dependency
  `qrcode-generator` 2.0.4 (MIT, no dependencies of its own). The SVG is built from the module matrix as a path, never
  as markup from a string.
- **Design source.** The approved P0 and advanced-feature designs contain the static-QRIS, void and "Pembayaran
  Online" onboarding screens but no screen for the PG waiting or refund state; those follow the guideline, the void and
  onboarding screens' patterns and the wording of the payment-api spec. Owner review of these screens is still due.

## Definition of Done

- [test] `parsePayment` copies only known fields and refuses a non-payment; `outcomeOf`/`keepPolling` (waiting, paid not
  yet completed, closed by expired/failed/cancelled; a cancelled sale never reads as paid; a QR time that is over is
  still waiting); countdown; cash-switch checks; late-receipt and cancel wording; resume memory (never throws); the QR
  matrix and path; error mapping for 503 (both codes, per route), 409 codes, 403/404/422.
- [test] Pay step: an online kind is its own step; the button label; online methods offered only while chargeable.
- [test] Refund state text, manual note check, refund guidance for `online`; a form field shown only for some values.
- [cmd] `npm run lint && npm run typecheck && npm run build` and `npx vitest run` in `apps/pos-web`.
- [qa] Pay dialog: online method, QR and VA waiting views, countdown, Cek status, Ganti ke tunai, Batalkan, paid /
  expired / failed / cancelled outcomes, late-receipt notice, reload resume (desktop and phone width), against the
  local fake gateway (steps in plan 2026-11-25-006).
- [qa] Sale page: refund of a paid online sale, pending / succeeded / refused, retry, manual mark as the owner and as a
  `sales.void` holder (button absent), the void of a CASHAC sale unchanged.
- [qa] Metode pembayaran: create an online method (QRIS and VA), the gateway field shows only for that kind.
- [manual] Owner review of the built screens against the approved designs 26 and 27 (approved 2026-11-26); server gaps are listed in the PR.

## Files

`apps/pos-web/src/routes/kasir/`: `-online.ts` (+ test), `-online-api.ts`, `-online-pay.tsx`, `-qr.ts` (+ test),
`-refund-panel.tsx`, edits to `index.tsx`, `-api.ts`, `-pay-step.ts`, `-void-*.ts(x)`, `riwayat.$id.tsx`,
`riwayat.index.tsx`, `struk.$id.tsx`; `routes/metode-pembayaran/index.tsx` and `routes/pelanggan/-form.ts`, `-ui.tsx`,
`-api.ts` (a field with `showWhen`; kind `online`); `lib/describe-error.ts`; `components/shell.tsx` (`useIsOwner`).

## PR 27 review fixes (2026-11-25)

Decisions are pure functions in `-online.ts`, each with a revert-red test: `resumeDecision` (a reload with no usable
answer keeps the sale and blocks the register: `ResumeGate`; a completed sale clears the order that made it), `mustRenewKey`
(the Idempotency-Key is the order's key; it changes only for another method after an online 503 that wrote a sale, never for the amount, so a lost cash answer is replayed, not doubled),
`finishPlan` (a sale picked from "Menunggu" never wipes or reopens the cart; `own` is remembered with the sale id),
`OPEN_PAST_CODE_TIME` (a code past its time with the payment still open is never "kedaluwarsa"), `saleFailure`,
`paidFigures` (paid and change come from the sale's receipt, never from the typed text). The cash form is locked once
the intent exists, the switch and cancel buttons stay usable after a reload, and a 503 on cancel / refund retry /
manual mark says the request may have arrived (`payment_unclear`).

Server gaps found: `SalePayment` has no cashier id, so a supervisor sees "Ganti ke tunai" until pos-api answers 409
`not_own_sale` (the button then goes away); `GET /sales?status=awaiting_payment` returns other cashiers' sales to
`reports.view` holders, whose payment route answers 404.
Not exercised: no browser run and no component tests (the resume, poll and `OnlineWait` flows are reviewed by reading).

### Second review round

`trackOwn` sets and clears the cart's own-sale record in one place (created on an online 503 too; paid, closed, cleared
and resolved orders forget it). `ResumeGate` offers "Lanjut tunai saja" when the check fails: online methods wait (the
pay dialog says so), cash does not, and the check keeps retrying. After a reload the cash intent needs no typed amount
(`cashPaidToSend`) and can be cancelled; a sale voided or refunded while away says so; `createSale` follows the sign-in
redirect; a code past its time is described by the screen's clock, not as expired.

### Third review round: one reducer for the pending sales and the key

Rounds 1 to 3 kept finding money bugs in the same place (the one-sale record in sessionStorage, the closures that
held the key). That logic is now ONE pure reducer, `-pending.ts`, with its transition table at the top of the file and
a test per event in `-pending.test.ts`. `-pending-store.ts` holds the state per tab and is the only code that reads or
writes its storage record (`pos.kasir.pending`; the old `pos.online-sale` record is read once). `index.tsx` and
`-online-pay.tsx` only dispatch events and read the state: no key is made or kept in a screen (guard test).

- **State:** the Idempotency-Key of the next sale, the sale written under it whose charge got no answer (`held`), two
  doubt flags (`unanswered`, `recorded`), and a LIST of unfinished online sales (id, the key each was written under,
  whether a pay code was shown, `held` / `unchecked` / `unreachable` / `open`). "Own" is not stored: a sale is the
  cart's own while it was written under the current key.
- **The key changes only when the sale under it is known to be over** (paid, cancelled by the gateway's refusal, its
  waiting screen closed, the check says it ended), when the cashier says a recorded sale was checked ("Sudah saya cek:
  buat penjualan baru"), or when the order moves on from an online sale that was never charged and never shown
  (another method, a cart edit, Hapus semua). A lost answer, a corrected amount, a cart edit, Hapus semua and a reload
  keep it: the first sale is replayed or refused with 422, never written twice. This replaces "a cart edit renews
  the key".
- **A tracked sale leaves the list only on its own answer.** A paid cash sale, Hapus semua, a picked sale or another
  sale's end never remove it. Every sale that needs a check is asked every 5 s (10 s timeout), also while the cashier
  went on with cash; online methods stay hidden until none is left.
- **No second sale of an order whose code may still be paid:** the request is not sent (`sendPlan` → `blocked`) and
  the pay dialog says to finish it from Menunggu, or Hapus semua for another customer.
- **The 422 of a used key** ("Permintaan berbeda dengan transaksi sebelumnya", and any 422 while a sale may exist
  under the key) opens "Penjualan sebelumnya mungkin sudah tercatat. Cek Riwayat dulu", with "Buka Riwayat" and the
  explicit new-sale button in the pay dialog. pos-api's 422 carries no code, so the text is matched: a stable code on
  that refusal is a pos-api follow-up.
- **The error dialog's "Coba lagi"** reads the key from the store when it runs, so QRIS 503, Tunai, 503, "Coba lagi"
  sends the cash sale's key again.
- An `awaiting_payment` answer whose payment cannot be read is remembered and asked again (it was shown as paid).
- Minors: cancelling a sale already turned into cash says the cash taken is recorded nowhere ("Batalkan
  pembayaran"); the gate keeps its buttons while checking; a late resume answer after Hapus semua no longer clears the
  new cart; a 409 while an uncharged online sale holds stock says so.

Not exercised: no browser run and no component test. The reducer, its selectors and `rehydrate` are unit-tested and
each guard was broken once and restored; the wiring in `index.tsx` / `-online-pay.tsx` (effects, the resume loop,
batching of `track`) is typechecked and read only. A cash/EDC sale that answered 503 with a sale id is not listed
(the job completes it); a `held` online sale is checked only after a reload.
