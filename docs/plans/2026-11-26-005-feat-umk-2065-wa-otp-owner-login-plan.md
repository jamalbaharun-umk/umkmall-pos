# UMK-2065: owner sign-in by UMKMall WhatsApp OTP

Linear: UMK-2065 (UMKMall side: UMK-2066). Design: https://claude.ai/artifact/D5Zgv53bXXfAaiyU5SMgXF

## Goal

A store owner signs in to the POS with a WhatsApp number and an OTP, as on UMKMall web and mobile. UMKMall stays the
only identity provider: pos-api calls apps/api's native auth (`/mobile/v1/auth/**`, credentials in JSON bodies), and
the POS keeps only the UMKMall user id (`pos.tenants.user_id`). This ends the POS dependency on the `.umkmall.id`
shared cookie (UMK-1947, blocked by UMK-2064). Cashiers keep their PIN on paired devices; the agent session is unchanged.

## Shape

- `POST /auth/otp/request {phone, consent?}`: UMKMall's consent status first; 409 `consent_required` (live versions)
  when consent is needed and absent, else UMKMall sends the code. Answers `{otpLength, expiresAt}`.
- `POST /auth/otp/verify {phone, otp, consent?}`: same consent check, UMKMall verifies, consent recorded with the new
  native access token (failure ends that native session), owner session stamped as a sign-in (fresh, UMK-2054), answers
  `umkmall: {sid, refreshToken}`.
- `POST /auth/umkmall/refresh {sid, refreshToken}`: UMKMall rotates, owner session never fresh, rotated token passed on.
- `POST /auth/umkmall/sign-out {sid, refreshToken}`: one refresh for an access token, then `DELETE /mobile/v1/auth/session`.
- UMKMall 400 → 422 on the field, 429 keeps its wait, 401 → 401, else 503 `umkmall_unavailable`.
- Per-address limit before UMKMall (10 requests, 30 verifies per 10 minutes), since UMKMall's own IP caps see only
  pos-api until UMK-2066.
- `UMKMALL_API_URL` unset → the four routes answer 404; https in production.
- pos-api stores no UMKMall token. pos-web (next PR) keeps `{sid, refreshToken}` in an httpOnly cookie.

## Definition of Done

- [test] request: code sent, consent_required with no send, malformed 422 without a call, 429 passthrough, 503
- [test] verify: fresh owner session, store created once; consent recorded with the bearer; record failure ends the
  native session; wrong code 422 on `otp`; unreachable 503
- [test] refresh: never fresh, rotated token passed on, grace keeps the client's token, 401 and 503
- [test] sign-out: refresh then DELETE with the new bearer; an ended session is fine
- [test] per-address limit refuses before UMKMall; routes 404 when switched off
- [test] revert-red: a refresh stamped as a sign-in fails "never fresh"
- [cmd] lint, typecheck, test, build
- [qa] next PR: sign in on preview with a real number

## Next (UI PR, after the design is approved)

Sign-in screen per the design, `pos_umkmall` cookie, `api()` refresh through `/auth/umkmall/refresh`, `/masuk/ulang`
to a fresh OTP, sign-out calls `/auth/umkmall/sign-out`, remove `POST /auth/umkmall/session` and the shared-cookie
code, update CLAUDE.md.
