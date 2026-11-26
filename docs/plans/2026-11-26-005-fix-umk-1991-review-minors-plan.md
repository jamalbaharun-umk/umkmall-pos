# UMK-1991: review minors of PR 34 (UMK-2055), PR 44 and UMK-2054

Date: 2026-11-26. Epic UMK-1924, payment-api UMK-1991. Server-side follow-ups only; pos-web is touched only in
`routes/masuk`, `routes/pengaturan/keamanan` (its server functions) and `lib/session.server`. The web half of
UMK-2055 (the retry dialog offers only the owner) is another change.

## Goal

Close the minor findings of three reviews without changing any flow: wrong comments, missing tests, two text
fixes, one replay answer made exact, one legacy field dropped, one CSRF check and one two-step call made one.

## Decisions

1. **Bank cache (UMK-2055).** The comment of `PaymentSync.banksOf` said a changed list "costs nothing": wrong, a
   bank added at the gateway is refused here for up to `BANKS_CACHE_MS` and a removed one is caught only by
   payment-api, after the sale is written (it is then cancelled with its stock back). The comment says so; the
   `BANK_REFUSALS` JSDoc goes back above its set. Unit tests: a hit asks once, an expired entry asks again, a
   failed answer is not kept.
2. **Account name (UMK-2055).** `accountNameOf` also drops U+061C and U+2060-2064, and cuts at 100 code points, so
   a surrogate pair is never split.
3. **Retry copy (UMK-2055).** `VoidPins.verifyOwner` answers in the owner's words: no PIN yet → 422 on `pin`,
   code `owner_pin_missing` ("Anda belum membuat PIN pembatalan…"); locked → 429, code `owner_pin_locked`,
   "buka kuncinya di Pengaturan, Keamanan (masuk lagi dulu)", never "minta admin lain". Another store's owner id
   stays the plain "PIN salah" and counts nowhere.
4. **Replay of a refused sale (UMK-2055).** Decided: a replay answers what the first request answered, not a guess
   from today's banks. The code payment-api refused the charge with is kept on the sale
   (`sales.payment_refused_code`, nullable, written with `cancel_reason = gateway_refused`); a repeat answers 422
   with it for a bank code, 409 with it for a gate code. `bankRefusalOf` (which recomputed from the cached banks and
   could answer `bank_required` for a gate refusal) is removed. A sale refused before this migration answers the
   plain 409 (online payments exist only in development and test).
5. **`saleNumbers` (UMK-2055).** The legacy field of the 409 `sales_awaiting_payment` is dropped: pos-web reads
   `sales[].holdNumber`/`holdDayLabel` already and nothing else reads it; with daily hold numbers it could read
   `[1, 1]`.
6. **PR 44.** The job's "stranded intent" check reads the intent's age on the database clock (the clock that wrote
   it), as `requestRenew` does. `renewStrandedMs` comes from `renewStrandedMsOf` with its assumption written down
   and guarded by a unit test: while a renew request holds the intent it waits on at most `RENEW_INTENT_CALLS` (3)
   payment-api calls (find, close, read after `already_paid`), each cut at `PAYMENT_API_TIMEOUT_MS`, so the bound
   (`afterMs` ≥ 2 timeouts, plus 4) leaves at least three timeouts of slack. Tests: a stranded intent is taken over
   by a new request; the A/B case (a live renew, a second one refused, then taken over once stranded: one live
   bill, the held request answers the new bill).
7. **UMK-2054 minors (pos-web).**
   - The landing (`/` without a POS session) stamps `signIn` only when the owner asked to sign in again
     (`pos_kembali` set by `/masuk/ulang`); a plain page load opens a session that is not fresh. The sign-in
     button (`POST /masuk`) stays a sign-in.
   - `POST /masuk/ulang` answers 403 unless the request is same-origin (`Sec-Fetch-Site: same-origin`, or without
     that header an `Origin` equal to the POS origin), so another site cannot drop the session and set the
     marker.
   - "Buat PIN baru" after "Lupa PIN" is one pos-api call: `PUT /void-pin/forgotten` `{ pin }` (owner only, fresh
     sign-in, `sales.void`), which replaces or makes the owner's PIN and clears its lock in one statement. The old
     window (PIN removed, new one refused) is gone.

## Definition of Done

- `[test]` `src/payments-client/payment-sync.spec.ts`: cache hit, expiry, a failed answer not kept; the stranded
  bound for the config's minimum.
- `[test]` `src/payments-client/sale-payment.spec.ts`: `accountNameOf` strips the new marks and never splits a pair.
- `[test]` `test/void.e2e-spec.ts`: owner without a PIN, locked owner (codes, no "admin lain"), another store's
  owner id; `PUT /void-pin/forgotten`: 403 without a fresh sign-in, 403 for a cashier, replaces and unlocks, 422.
- `[test]` `test/pg-cashier-flow.e2e-spec.ts`: a repeat of a bank-refused sale answers its code even when the
  banks changed; a gate-refused sale's repeat answers 409 with its code; stranded take-over; A/B.
- `[test]` `test/sale-numbers.e2e-spec.ts`, `pg-cashier-flow`: no `saleNumbers`.
- `[test]` pos-web: the same-origin helper, the landing's sign-in rule, `replaceForgottenPin` one call.
- `[test]` revert-red: the new marks, the code-point cut, the owner copy, the stored refusal code, the DB-clock
  check, the cache's "no answer is not kept", the same-origin check, the fresh check of `forgotten`.
- `[cmd]` root lint, typecheck, build; payment-api suite; pos-api `jest --runInBand` (payment suites first); pos-web
  vitest.
