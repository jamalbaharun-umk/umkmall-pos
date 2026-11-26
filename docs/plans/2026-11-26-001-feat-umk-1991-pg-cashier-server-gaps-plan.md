# UMK-1991: server gaps of the cashier's PG flow (UMK-2040, 2047, 2039, 2037, 2045)

Date: 2026-11-26. Epic UMK-1924, payment-api UMK-1991. Found while building the cashier PG screens (PR 27, approved
designs 26 and 27). Builds on plans [2026-11-25-006](2026-11-25-006-feat-umk-1991-pg-cashier-flow-plan.md) (pos-api
flow) and [2026-11-25-003 fake gateway](2026-11-25-003-feat-umk-1991-fake-gateway-plan.md). Server only: pos-api and
payment-api. The pos-web screens follow in their own change and are named under "Not in this plan".

## Goal

Close five gaps between the approved cashier designs and the server, plus one reviewer note of PR 24, each as its
own commit. The legal lock (UMK-1977) stays: the only gateway is the local fake one.

## Decisions

1. **UMK-2040: a refund retry is the owner's, approved by a PIN.** `POST /sales/:id/refund/retry` answers 403 to
   anyone who is not the owner, before the body is read. The body is `{ approverId, pin }` (strict): the approver
   holds `sales.void` and types their void PIN, checked by `VoidPins.verify`, so the lockout is the void's own (the
   5th wrong PIN locks that approver for 5 minutes, 429 with `Retry-After`; one counter for voids, refunds and
   retries). Order: 403, 422 (body), 404 (no refund on that sale, also another store's), PIN, then payment-api. The
   reason and note stay those of the refund; payment-api's audit row of the new refund request names the owner as
   actor and this retry's approver.

   The owner PIN could be reset/unlocked by a signed-in session without the old PIN: UMK-2054
   (https://linear.app/umkmall/issue/UMK-2054). Decided: change needs the old PIN, reset/unlock needs a fresh UMKMall
   re-login. Built, see "UMK-2054" at the end of this plan.
2. **UMK-2047: the cashier on the payment and on the list.** `SalePayment` and every row of `GET /sales` carry
   `actorId` and `mine` (the caller rang it up). `GET /sales?status=awaiting_payment` lists what the caller may act
   on, the rule of the payment routes: their own sales, or every waiting sale of the store with `sales.void`.
   `reports.view` alone no longer lists other cashiers' waiting sales (their payment route answers 404). Other lists
   keep their scope.
3. **UMK-2039: validity per method.** An adapter declares which validity its bills get (`validity: 'qr' | 'va'`,
   default `qr`); `PAYMENT_QR_TTL_SECONDS` (900) stays and `PAYMENT_VA_TTL_SECONDS` is new. `expires_at` is set from
   it at the charge; everything after it already counts from the bill's own `expires_at` (the automatic `expired`
   after the grace, the late-money sweep until expiry plus `PAYMENT_LATE_SWEEP_SECONDS`, the fake gateway closing a
   bill), so those windows follow. **Default 3600 (60 minutes), the sample value of design 26: the owner has not set
   it (open question below).**
4. **UMK-2037: the bank is chosen before the VA is made.** An adapter declares `banks` (`{ code, name }[]`) for a
   method that needs one. payment-api: `ChargeBody.bank` (optional), 422 `bank_required` / `bank_unknown` for a
   method with banks, `bank_not_supported` for one without; stored in `payments.bank` (the adapter is told again on a
   repeated call) and part of the request fingerprint only when present (old keys still replay). A merchant
   account's methods answer their `banks`. pos-api: `GET /online-payments/methods` adds `banks` (by method);
   `SaleInput.bank`; the sale stores it in `sales.payment_bank` (the job and a repeat charge with the same body).
   Before the sale is written pos-api asks payment-api for the method's banks and answers 422 on `bank` (nothing
   taken); when payment-api cannot be reached the sale goes on as today and payment-api's own check decides: its bank
   refusal closes the key and cancels the sale at once (422 on `bank`), like a gate refusal. The fake gateway:
   `fake_va` has banks `FAKE` and `FAKE2`.
5. **UMK-2045: the VA's account holder name.** `checkout.accountName`, a well-known key of the adapter contract: the
   gateway's label for the virtual account. payment-api stores `checkout` as it does today; `SalePayment.checkout`
   passes `accountName` on. No bank account or identity data of the store is added; the fake gateway answers a
   fixed label.
6. **PR 24 reviewer note.** `POST /sales/:id/payment/cash`: when payment-api answered with a 4xx that is not a
   clear refusal of the bill (400, 401, 403, 429: `PaymentApiError` kind `unavailable` with a 4xx status), the
   request DID get an answer, so "tidak menjawab" (`cash_switch_unanswered`) is wrong. It answers 409
   `payment_refused`. No answer at all (network, timeout, 5xx) keeps the 503.

Migrations (one per app, each in its own commit, generated after `git fetch`): pos-api `sales.payment_bank`,
payment-api `payments.bank`. Both nullable text, no backfill.

## Definition of Done

- `[test]` retry: non-owner 403 (cashier, and a `sales.void` supervisor, also with an empty body), wrong PIN 422 and
  nothing asked at the gateway, 5th wrong PIN 429 with `Retry-After`, a locked approver refused with the right PIN,
  a supervisor's PIN approves the owner's retry, other store 404. Revert-red: owner check, PIN check.
- `[test]` awaiting list: a cashier sees only their own, `reports.view` without `sales.void` only their own,
  `sales.void` all; rows and `SalePayment` carry `actorId`/`mine`; store B sees none of A's and gets 404. Revert-red.
- `[test]` payment-api: a VA expires after the VA validity and a QR after the QR validity; the fake gateway keeps a
  VA payable after the QR validity; late money on a closed VA is found by the sweep after the QR window would have
  ended; config parses and defaults.
- `[test]` bank: payment-api 422 missing/unknown/not supported, stored, replay with another bank refused, account
  methods answer banks, other tenant 404; pos-api 422 missing/unknown and nothing written, the VA carries the chosen
  bank, `GET /online-payments/methods` answers banks, a replay answers the same sale.
- `[test]` `checkout.accountName` reaches `SalePayment.checkout` for a VA and is absent for a QR.
- `[test]` cash switch: a 400 from payment-api answers 409 `payment_refused`, the sale still waits. Revert-red.
- `[cmd]` `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=… PAYTEST_DB=… npx jest --runInBand`
  in `apps/pos-api` and `apps/payment-api`.

## Files

pos-api: `src/void/` (controller, schemas, service), `src/payments-client/` (payment-sync, sale-payment, client,
online-payments controller), `src/sales/` (schemas, service), `src/db/schema/sales.ts`, one migration,
`test/pg-cashier-flow.e2e-spec.ts`, `test/online-payments.e2e-spec.ts`. payment-api: `src/config.ts`,
`src/adapters/` (contract, fake gateway), `src/payments/` (schemas, service, settlement), `src/merchants/`,
`src/db/schema/payments.ts`, one migration, `test/fake-gateway.e2e-spec.ts`, `src/config.spec.ts`. `CLAUDE.md`,
`.env.example`.

## Not in this plan

- **pos-web.** The retry button needs the PIN dialog (approver and PIN, as the void dialog); until then "Coba lagi"
  answers 422. The VA sale needs the bank chips; until then a `fake_va` sale from pos-web answers 422 on `bank`. The
  awaiting list and the waiting screen can hide actions with `mine`. The "a.n." line reads `checkout.accountName`.
- A real provider's banks and validity (UMK-1977).

## Open owner questions

- **The VA validity.** 60 minutes is design 26's sample. Set `PAYMENT_VA_TTL_SECONDS` before deploy.
- ~~Who may approve a retry.~~ Decided 2026-11-26, see below.

## After the PR 32 review (2026-11-26)

- **Owner decision: a retry needs the owner's OWN PIN.** `VoidPins.verifyOwner`: the approver id must be the
  store's owner; any other id, also an admin's with `sales.void` and the right PIN, answers the generic "PIN salah",
  asks nothing and counts against nobody. The owner's count and lock are shared with void. This replaces "a
  `sales.void` holder" in decision 1. `sale_voids.approved_by` keeps the refund's approver; the retry's approver is
  on payment-api's audit row.
- **Validity bounds.** `PAYMENT_QR_TTL_SECONDS` and `PAYMENT_VA_TTL_SECONDS` are 60 to 604800 (7 days): 0 or an
  empty variable made every bill expired at birth, a huge value overflowed the date (500). A boot error outside.
- **Decision 6, narrowed.** Only 400, 401, 403 and 429 are payment-api's own refusal (409 `payment_refused`). Any
  other 4xx (a proxy's 408 or 499) says nothing about what was closed and stays the 503.
- **`accountName`** reaches the screen without control characters and invisible direction marks, cut to 100
  characters; dropped when nothing is left.
- **Minors.** The banks of a store are kept in memory for 30 s (`PaymentSync.banksOf`; an answer only, never "no
  answer"), so a busy till does not ask payment-api before every online sale. A repeat of a sale that payment-api
  refused for its bank answers the same 422 and code (worked out again from the sale's bank and the method's
  banks; 409 as before when payment-api cannot say). Superseded by plan 2026-11-26-005: the code is stored on the sale and a repeat answers it.
- `[test]` each of the above; revert-red on the owner check of the approver, the four statuses, the name's
  cleaning and the repeat's 422.

## UMK-2054: the owner's own PIN is not changed by the session alone (2026-11-26)

The retry of a refused refund asks the owner's own PIN, but an owner session could remove that PIN
(`DELETE /void-pin/<ownerId>`), make a new one (`PUT /void-pin` without `currentPin`) and clear its lock
(`POST /void-pin/<ownerId>/unlock`). So the PIN added nothing to the session.

Decided and built:

- **Changing the owner's PIN needs the old PIN** (`VoidPins.set`, as before): a missing one answers 422 on
  `currentPin`, a wrong one 422 "PIN salah" and counts toward the PIN's own lock (the void's: the 5th locks, 429).
  Nothing changes. A fresh sign-in does not stand in for the old PIN.
- **Without the old PIN, the owner's own PIN row needs a fresh sign-in:** removing it (forgot PIN), clearing its
  lock, and making the first PIN (there is no old one to ask for; without this the removal guard would only move the
  hole to stores whose owner has no PIN yet). Otherwise 403 `{ code: 'fresh_sign_in_required' }` and nothing changes.
- **Fresh** = an owner session whose sign-in is at most 5 minutes old (`FRESH_SIGN_IN_SECONDS`, `freshSignIn` in
  `src/tenancy/session.ts`). The token carries the sign-in time (`auth_time`, `PosSession.signedInAt`).
  `POST /auth/umkmall/session` stamps it only when the body says `{ signIn: true }`; pos-web sends that from the
  sign-in page (`POST /masuk`) and the landing after UMKMall's login (`/` without a POS session), never from the
  refresh in `api()`. A refreshed session carries no sign-in time, so a refresh is never fresh, also seconds after
  a sign-in. The dev sign-in (development and test only) is always a sign-in.
- **Admin PINs are as before.** First PIN without a fresh sign-in; the owner unlocks and removes an admin's PIN from
  any owner session. Judged not the same hole: the owner cannot set an admin's PIN (`set` is the actor's own), an
  admin's PIN never approves an owner-only action (`verifyOwner`), and for a plain void the owner session already
  holds `staff.manage` (it can make a new admin), so an admin's PIN was never a barrier against the owner.
- **pos-web** (Pengaturan, Keamanan): the change form asks "PIN lama"; a wrong one says the PIN did not change.
  "Lupa PIN?" (also the first PIN and "Buka kunci" on the owner's own row, when pos-api asks) opens "Masuk lagi":
  `POST /masuk/ulang` drops the POS session, remembers where to land (`pos_kembali`, a key of `RETURN_PATHS`, never a
  path) and goes to UMKMall's login; the sign-in that follows lands on `/pengaturan/keamanan?lupa=1`, where "Buat
  PIN baru" removes the old PIN and saves the new one.

**Limit, for the owner to rule on.** pos-api learns only "UMKMall accepts this cookie" from `/api/auth/me`; it cannot
see whether UMKMall asked for the password just now. While the browser still holds a valid UMKMall cookie, UMKMall's
login may send the owner straight back, and that sign-in counts as fresh. So this closes the hole for a POS session
or token on its own and for the plain routes, not for someone who holds the owner's UMKMall cookie. Closing that
needs UMKMall (its own process): `/api/auth/me` answering the time of the last password login, and a login that
asks again (`prompt=login`). pos-api would then take the sign-in time from UMKMall's answer instead of the relay's
`signIn`.

- `[test]` `test/void.e2e-spec.ts` "the owner's own PIN (UMK-2054)": old PIN missing/wrong and the lock; remove,
  first PIN and unlock refused without a fresh sign-in (no sign-in time, 301 s old, in the future) and done with one;
  admins as before; another store's fresh owner gets 404. `test/auth.e2e-spec.ts` "fresh sign-in": a sign-in is
  fresh, the refresh after it is not, the body takes only `signIn: true`, the dev sign-in.
  `test/pg-cashier-flow.e2e-spec.ts`: the reported way in ends in "PIN salah" on the retry; the owner's lock is
  cleared only by a fresh session; an admin's PIN is still refused for the retry (V4).
- `[test]` revert-red, each red then restored: the fresh check in `reset`, in `unlock`, in the first `set`; the old
  PIN in `set`; `signIn` ignored in the session route (every session stamped); the 5-minute window.
- `[test]` pos-web: `-keamanan-helpers.test.ts`, `session.server.test.ts` (a refresh sends `{}`, the landing cookie
  is a listed key and used once), `api.server.test.ts` (the refresh passes no sign-in), `sign-in.test.ts`.
