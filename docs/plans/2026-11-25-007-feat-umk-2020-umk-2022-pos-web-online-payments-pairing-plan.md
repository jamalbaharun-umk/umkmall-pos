# UMK-2020 + UMK-2022: pos-web "Pembayaran Online" and device pairing screens

Epic UMK-1924 (U4 staff and devices, UMK-1991 payments). Designs approved by the owner:
"Desain Pembayaran Online dan Akses Admin" (features 22 and 23) and "Panduan Dasar UI POS".

## Goal

Build the two owner/cashier screens on top of the pos-api routes that already exist.

1. **Pembayaran Online** (UMK-2020), `/pengaturan/pembayaran-online`, owner only (`payments.manage`): the store's
   account at a payment gateway: status, the short draft (no KTP, identity number, document or bank account),
   submit, the gateway's hosted verification page, the seven statuses, and the QRIS/VA switches.
2. **Device pairing by code** (UMK-2022): the signed-out device at `/kasir/masuk` shows a 6-digit code with a
   10-minute countdown and polls; the owner types it in Pengguna > Perangkat (`staff.manage`).

Out of scope: pos-api and payment-api changes, the cashier's payment screen, "Peran Admin" and "Undang admin"
(features 24 and 25), packages/ui.

## Routes used (read from pos-api source, not guessed)

- `GET /online-payments` -> `{ enabled, mode, accounts[] }`; `PUT /online-payments/:provider/draft` (strict: businessType,
  businessName, email, phone); `POST .../submit` `{ termsAccepted: true }`; `POST .../verification-link` -> `{ url }`;
  `POST .../sync`; `PUT .../methods/:method` `{ enabled }`. Refusals keep `status` and a lower-case `code`
  (`merchant_locked`, `draft_incomplete`, `merchant_not_verified`, `verification_not_open`, ...); no answer is 503.
- `POST /auth/device/pairing` (start, public), `POST /auth/device/pairing/status` (public, body `pairingToken`),
  `POST /staff/devices/pair` `{ code, name }` (session + `staff.manage`; 422 per field `code`, 429 + `Retry-After`).

## Decisions

- Screens use only `@umkmall/ui` and the existing `Page`/`Panel`/`Empty` wrappers; one nav line in `nav.ts`
  (`Pembayaran Online`, `payments.manage`, under Pengaturan).
- Every action: success toast (`notifySuccess`) or the error dialog (`showError`). The screen's own mapping is
  `describeOnlineError` (`lib/online-payments.ts`), passed as a third argument of `showError`; the owner's pairing
  entry uses `describePairError`. Both specialise 403/409/422/503 and delegate the rest to `describeError`.
- The pairing token and the device token never reach page JS: the cashier device keeps them in httpOnly cookies
  (`pos_pairing` holds the token, the code and its end so a reload shows the same code; `pos_device` is the existing
  device cookie, set on `paired`). The code is shown on screen only.
- **The device's address:** pos-web's relay for `POST /auth/device/pairing` and `.../status` sends
  `X-Forwarded-For` = the chain pos-web received + the address the device connected from (`buildForwardedFor`).
  pos-api trusts it only for `POS_TRUSTED_PROXIES`.
- The verification page opens in a new tab opened inside the click (a later `window.open` is blocked), only for an
  http(s) address (`safeHostedUrl`).
- Method switches are enabled at `verified` and `active` (design note: the first method needs `verified`); turning one off
  asks to confirm.

## Definition of Done

- [test] `lib/online-payments.test.ts`: the seven statuses and their next step, switch/draft locks, draft body has the four
  fields only, submit needs all four plus terms, hosted URL guard, error mapping for 403/409/422/503 and known codes.
- [test] `lib/pairing.test.ts`: code check, grouping, countdown, `buildForwardedFor` (none, chain, IPv6, empty),
  cookie round trip and rejection, owner-side error text (422, 429 minutes/seconds, 403).
- [test] `nav.test.ts`: the new entry shows only with `payments.manage` and is the active one on its route.
- [cmd] `npm run lint && npm run typecheck && npm run build` and `npx vitest run` in `apps/pos-web` are green.
- [qa] Both screens at phone width and desktop width, loading, empty, error, each status, with pos-api and the fake
  gateway running. **Not done in this change**; see the report.
- [manual] A real two-device pairing (tablet + owner phone) behind the production proxy, to see the device's own
  address counted per address. **Not done.**

## Files

- `apps/pos-web/src/lib/online-payments.ts`, `lib/pairing.ts`, `lib/pair-errors.ts` (+ tests); `lib/feedback.ts`
  (`showError` takes an optional describer).
- `apps/pos-web/src/routes/pengaturan/pembayaran-online.tsx`, `-online-api.ts`.
- `apps/pos-web/src/routes/kasir/masuk.tsx` (unpaired branch), `kasir/-pairing-screen.tsx`.
- `apps/pos-web/src/routes/staf/perangkat.tsx`, `-pair-dialog.tsx`, `-pairing-api.ts`.
- `apps/pos-web/src/nav.ts`, `routeTree.gen.ts` (generated).

## Known gaps against the design

- The design's "Referensi: ONB-..." code and the "Hubungi bantuan UMKMall" button have no source (no reference in the
  API, no contact address in the repo): the Ditolak state shows the gateway's reason and the instruction only.
- The cashier device is not asked for a device name (the start route takes none); the owner names it on entering the code.
- No auto-open of Dialog as a bottom sheet is built here: `Dialog` from `@umkmall/ui` is already a sheet below `md`.
