# UMK-1971: correct a kasbon payment (design fase 2, feature 31 "Koreksi kasbon")

Goal: a wrongly recorded kasbon instalment (wrong amount, wrong way of paying, wrong customer) is corrected without
overwriting or deleting anything. Approved by the owner: a correction is a REVERSAL line plus, optionally, a new
payment (append-only); closed days and closed shift reports never change; the reversal and the new payment are dated
on the day of the correction. Replaces feature 9 (edit/delete a receivable payment).

## Rules kept

- The book stays append-only. A correction writes, in one transaction under the receivable's row lock:
  a reversal row in `pos.receivable_payments` (`reverses_id` = the original, `amount` = minus the original amount),
  and, unless "Batalkan saja", a new payment row (`replaces_id` = the original). The original row is never touched.
  Remaining = kasbon total − Σ book rows (payments − reversals); `receivables.rest` moves by `+old − new`.
- One correction per payment: a unique index on `reverses_id`, checked under the lock first (`ALREADY_REVERSED`).
  A reversal row and a kasbon's down payment (part of its sale, no Idempotency-Key) are not correctable
  (`NOT_CORRECTABLE`, `DOWN_PAYMENT`); a voided kasbon is not either (`RECEIVABLE_CANCELLED`).
- `sales.void` (design: "untuk pemilik dan staf berizin void") on top of `receivables.manage` to reach the kasbon;
  a reason (`wrong_amount`, `wrong_method`, `wrong_customer`, `duplicate`, `other` + note) and an approver's PIN,
  checked by `VoidPins.verify` as a void is (wrong PIN 422, lock 429). No default role gains a permission (Admin
  already holds `sales.void`), so no role migration. Never an agent route; a person at the till only.
- Idempotency-Key on the request, stored on the reversal row with the request hash (PIN not hashed); the new
  payment row carries `<key>.n` (a `.` never appears in a client key). Replay answers the first result without a
  PIN attempt; another body under the key is 422 `IDEMPOTENCY_KEY_REUSED`.
- Cash: a reversal of a cash instalment taken in a shift goes out of THAT shift when it is still open; when it is
  closed the closed shift never changes and the reversal goes out of the actor's open shift (as a void does);
  no open shift then → 422 `SHIFT_REQUIRED`. A new cash payment follows the instalment rule (actor's open shift, or
  outside a shift for a collector who cannot open one). Ledger kind `receivable_reversal` (out) in both ledgers.
- Collector cash: a reversal of an instalment collected outside a shift is a store ledger `out`
  (`receivable_reversal`) and lowers that collector's held cash ("Setoran penagih": collected − reversed −
  deposited). It may not take it below what deposits already covered: refused 422 `REVERSAL_EXCEEDS_HELD` with
  `outstanding`, under the collector's staff row lock (the lock a deposit takes).
- payment-api (UMK-1991): after the commit the original payment is voided there (recorded first if it was not),
  with the correction's reason, actor and PIN approver (`receivable_payments.payment_sync_pending`, repeated by the
  job, kind `receivable_reversal`); the new payment is recorded with the next `seq` as any instalment.
- A void of the kasbon later gives back only the payments still standing (not reversed ones, not reversal rows).
- Kasbon report (PR #60): "Dibayar" = Σ book rows with a key, so a reversal (negative, with a key, dated at the
  correction) lowers it on the correction's day. "Dipegang penagih" must subtract `receivable_reversal` store
  ledger `out` rows like `StoreCashDepositsService.collectors()` does now (noted for that PR).

## Definition of Done

1. [test] Design example, exact numbers: kasbon Rp6.000; transfer Rp1.000 cancelled ("Batalkan saja") → sisa
   Rp6.000; cash Rp2.500 → sisa Rp3.500; corrected to Rp3.000 → sisa Rp3.000, history shows the three rows.
2. [test] Reversal + new payment are atomic (a refused new payment leaves no reversal) and idempotent (same key twice
   → one correction, PIN not asked again; revert-red).
3. [test] Second correction of the same payment 422 `ALREADY_REVERSED`; correcting a reversal row 422; down payment
   422; voided kasbon 422.
4. [test] Shift still open: its expected cash drops; closed shift: unchanged, the reversal is in the actor's open
   shift; no open shift → `SHIFT_REQUIRED`.
5. [test] Collector cash: held cash drops by the reversal; above what is still held (after a deposit) → 
   `REVERSAL_EXCEEDS_HELD` (revert-red).
6. [test] 403 without `sales.void`; wrong PIN 422; reason missing 422; store B gets 404 on store A's receivable and
   payment for the correction and the read.
7. [test] payment-api on: the original payment is voided there and the new one recorded.
8. [test] pos-web vitest for the pure helpers (form checks, rest after, cash effect text, row status).
9. [cmd] lint, typecheck, build, pos-web vitest, pos-api suites. [qa] Browser at 375 and 1024.

## Files

- `apps/pos-api/src/db/schema/receivables.ts` (+ migration), `shift-cash.ts`, `store-cash.ts`, `payment-sync.ts`
  (one kind each), `src/receivables/receivable-corrections.service.ts` (new), `receivables.controller.ts`,
  `store-cash/store-cash-deposits.service.ts` (held cash), `void/void.service.ts` (standing payments only),
  `payments-client/payment-sync.service.ts` (void of a reversed payment), `shifts/shifts.service.ts` (reversed flag).
- `apps/pos-api/test/receivable-corrections.e2e-spec.ts` (new).
- `apps/pos-web/src/routes/piutang/$id.tsx`, `-correction.ts`, `-correction.test.ts`, `-correction-dialog.tsx`,
  `pelanggan/-api.ts`, `kasir/-shift-helpers.ts` (labels).
