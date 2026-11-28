# UMK-2124: "Serahkan ke pembantu", hand the till to a helper without ending the owner's session

Linear: UMK-2124 (parent UMK-2119, stage 2 of solo-owner mode). Design 42, approved 2026-11-28 with every proposed
answer: the parked session ends after 12 hours, the helper's name is optional, 5 wrong PINs lock for 5 minutes.
Goal: when family helps for an hour, the owner parks the session behind the owner PIN and a sales-only till opens on
the same device. The owner comes back with the PIN, with no new WhatsApp code.

Two PRs: the server (this plan's pos-api part, with its tests), then the screens.

## Security model

- **A new session kind, `helper`, fail-closed like the agent.** The token carries `hsid` (the `pos.helper_sessions`
  row). It reaches only routes marked `@HelperRoute()` (an allow-list in the session guard, pinned in
  `src/guards.spec.ts`). Every other route answers 403 for a helper, whatever its permission.
  - Allowed: read the till (`GET /shifts/current`, products for sale, sales settings, payment methods, the store
    profile, `GET /tenant/me`), `POST /sales/quote`, `POST /sales`, a receipt of the helper's own sale, and
    `POST /helper/end`.
  - Its permissions are `sales.create` only, set by the session guard per request from the live row.
  - `kind` is `helper`, never `owner`, so every inline owner check (owner PIN, owner's take, fresh sign-in, solo
    self-approval of a discount, auto-open) stays false for it.
- **What a helper can sell.** Cash, EDC and static QRIS. No kasbon, no online payment (the waiting screen is not
  part of the restricted till), no line or order discount, no manual price, no voucher, no member. The helper's
  sale input has none of these fields, so one sent answers 422; a kasbon or online method answers 403
  `helper_not_allowed`. Void, refund, drawer cash, close: not reachable at all.
- **The sale goes into the owner's shift.** The helper token's actor is the owner (the shift is keyed by actor), and
  the sale is written with `actor_kind = 'helper'` and `sales.helper_session_id`, shown as "Pembantu". Starting the
  handover needs an open shift: in a solo store it is opened then (UMK-2120's automatic opening), otherwise 409
  `shift_required`.
- **Start needs the owner's own PIN** (`POST /helper/start` `{ pin, name?, parkedSid? }`, owner session only, not
  an agent route). The owner PIN is checked with the void's rules (`VoidPins.verifyOwner`: wrong 422, locked 429
  `owner_pin_locked`, none 422 `owner_pin_missing`). At most one live handover per owner (409 `helper_active`).
  The answer is the helper token, valid until the row's `expires_at` (12 hours).
- **The owner's session is parked, not kept on the device.** pos-web replaces the owner's POS token with the helper
  token. The owner's UMKMall native session (the `pos_umkmall` cookie) stays, so no new WhatsApp code is needed,
  and pos-api blocks its use while parked: `parkedSid` is stored as a sha256 hash, and
  `POST /auth/umkmall/refresh` answers 403 `session_parked` for a sid whose handover was not ended by the owner's
  PIN. That includes a handover that expired: after 12 hours the native session stays refused, so the owner signs in
  again by WhatsApp (design 42).
- **Coming back** (`POST /helper/end` `{ pin }`, helper session): the owner's PIN, counted with the void's rules
  on the owner's PIN row (`VoidPins.verifyOwner`: `MAX_PIN_FAILURES` 5, `PIN_LOCK_SECONDS` 5 minutes, 429
  `owner_pin_locked`). That is design 42's "5 wrong, 5 minutes", and one counter for the owner PIN means a helper
  cannot get 5 guesses here and 5 more at a void. A right PIN ends the row
  (`ended_reason = 'owner'`) and answers a new owner token (never fresh: making or resetting the PIN still needs a
  WhatsApp sign-in). An expired or ended row answers 401: the helper token is dead.
- **Review of PR 109 (reviewer blockers, coordinator's calls 2026-11-28, safer option each time):**
  - `GET /shifts/current` answers a helper only `{ shift: { id, openedAt } | null, autoOpen: false,
    discountPinRequired: true }`: no revenue, profit, cost or drawer ledger of the owner's shift.
  - **The parked native session is bound.** An owner token from a WhatsApp sign-in or its refresh carries `nsh`, the
    sha256 of the native session id it came from. `POST /helper/start` then needs `parkedSid` and its hash must equal
    `nsh` (422 on `parkedSid` otherwise), checked before the PIN is counted. Where native sign-in exists
    (`UMKMALL_API_URL` set) an owner token without `nsh` (signed before this change) answers 403 `sign_in_again`.
    Only without native sign-in (development) is nothing parked. The owner token handed back by `/helper/end`
    carries the unparked `nsh`.
  - **Changing the owner PIN.** Before this change, changing an existing owner PIN with the current PIN needed no
    fresh sign-in (`void-pin.ts`, `set`), so a helper who saw the PIN could have changed it from the owner token that
    `/helper/end` answers. Now, when a handover of this owner was created since the PIN was last set, changing it
    needs a fresh WhatsApp sign-in (403 `fresh_sign_in_required`), during or after the handover. A change after that
    sign-in moves the PIN's `updated_at` past the handover and the usual rule is back. Making, resetting and
    unlocking the PIN already needed a fresh sign-in, and the `/helper/end` token is never fresh.
  - **The owner ends a handover from a fresh sign-in:** `POST /helper/close` (owner, fresh sign-in, else 403
    `fresh_sign_in_required`), for a lost or signed-out helper device that would otherwise leave the owner at 409
    `helper_active` for 12 hours. It ends the live row as `signin` (or `expired` if past its end); 409
    `helper_not_active` when there is none. A `signin` end keeps the parked native session refused (the sign-in made
    a new one).
  - **Audit of refusals at "Kembali ke pemilik":** `helper_end_refused` (`wrong_pin`, `locked`, `missing`), written
    in its own transaction, never the PIN.
  - **The parked native session on the device** stays only in the httpOnly `pos_umkmall` cookie (never readable by
    page script), refused by pos-api until the PIN. pos-web's "Kembali ke pemilik" refreshes it at once after the
    PIN (UMKMall rotates the refresh token where it does), in the screens PR.
- **Audit:** `helper_start` and `helper_end` (group `access`): the handover id, the expiry, the end reason. Never the
  helper's name, a PIN or a sid.
- **Never logged:** the PIN, the sid, the token, the helper's name.
- **Purge:** `helper_sessions` has `tenant_id`, so the purge covers it.

## Definition of Done (server PR)

- [test] `test/helper-handover.e2e-spec.ts`:
  - start needs the owner PIN (wrong, locked, none), an owner session, one live handover; a solo store opens the
    shift, a store with staff and no shift gets 409;
  - the helper sells cash into the owner's shift, labelled `helper`; a discount, a manual price, kasbon, a voucher
    and an online method answer 403;
  - every other route answers 403 for a helper (void, cash entry, close, catalog edit, reports, staff);
  - end: wrong PIN 422, 5 wrong lock 5 minutes (429 `owner_pin_locked`), right PIN ends it and answers an owner token; the old
    helper token is then 401;
  - an expired handover is 401, and the parked sid stays refused by the refresh; a sid released by the PIN is
    accepted again;
  - store B cannot end or use store A's handover.
  - review of PR 109: the helper's shift shape; a start without `parkedSid`, with another sid, or from a token
    without `nsh`; a forged `hsid` is 401; the helper quote refuses voucher, discount and price; an online method is
    403; wrong PINs at the end are audited; the `/helper/end` token is not fresh and the PIN changes only after a
    fresh sign-in; `POST /helper/close` (fresh only, ends as `signin`, sid stays refused, other store untouched).
    Revert-red on the shift shape and the sid binding.
  - Revert-red once on the route allow-list and once on the refresh block.
- [test] `src/guards.spec.ts` pins the helper routes.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.

## Screens (second PR)

- Till, owner: "Serahkan ke pembantu" (dialog: "Nama pembantu (opsional)", "PIN pemilik", Batal / Serahkan),
  toast "Kasir diserahkan ke pembantu".
- Restricted till: "Mode pembantu · {nama}", products, cart, Bayar; no menu, no discount, no manual price;
  "Kembali ke pemilik" opens the PIN screen (Batal / Buka sesi pemilik). Wrong PIN uses the shared error dialog
  ("PIN pemilik salah", 5 wrong lock 5 minutes).
- Coach-mark guide for the restricted till.
- [qa] 375 px and 1280 px.
