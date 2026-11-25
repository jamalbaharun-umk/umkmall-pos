# UMK-1991: payment gateway onboarding, `payments.manage`, default Admin role, device pairing (server side)

Epic UMK-1924. Issues: UMK-2019 (onboarding in payment-api and its passthrough in pos-api), UMK-2021
(`payments.manage` and the default Admin role), UMK-2022 (device pairing code). Not here: UMK-2023, UMK-2024.
Design: "Onboarding payment gateway dan akses admin UMKMall POS" (2026-11-25, payments thread), which the owner
asked to be built as recommended. **Server only**: the screens wait for the designer and the owner's approval.

Real gateways stay behind the legal gate (UMK-1977): everything here runs against the local fake gateway
(`PAYMENT_ADAPTERS=fake`), and nothing under `apps/payment-api/src` calls out (guard test unchanged).

## Goal
1. A store can be onboarded for online payments as a sub-account of the platform at a gateway (design model A):
   the owner saves a short draft in the POS, submits it, verifies on the gateway's own page, and then switches
   methods on. A PG charge is refused unless the store's account is `active` and the method is on.
2. Only an actor with the new permission `payments.manage` reaches the "Pembayaran Online" routes; a store gets a
   default `Admin` role.
3. A cashier device is bound without the owner signing in on it: the signed-out device shows a 6-digit code, the
   owner enters it on their own signed-in device.

## Design assumptions that are the payments thread's proposals (not yet owner rulings)
- The default **Admin** role holds every permission except `staff.manage` and `payments.manage`
  (`ADMIN_EXCLUDED_PERMISSIONS` in `apps/pos-api/src/staff/permissions.ts`, one constant). It therefore holds
  `sales.void`.
- (Approved by the owner on 2026-11-25, with the rest of the design.) The pairing code lives **10 minutes** and locks like PIN sign-in: 5 wrong codes, then 30 s doubling to 15 min
  (`PAIRING_CODE_TTL_SECONDS` in `apps/pos-api/src/staff/device-pairing.ts`; the lock is `lockSeconds` of PIN sign-in).
- Draft fields: business type (`individual`/`company`), business name, email and phone of the person in charge,
  and the terms agreed at submit. Nothing else is collected.
- Statuses and what the owner may do in each are the design's table. `rejected` is final for the owner (support);
  a gateway that reopens the account is still followed.
- The existing `Pemilik` roles of existing stores are **not** given `payments.manage` by the backfill (the owner
  session holds every permission in code; a staff member holding the role `Pemilik` is a deliberate grant).
- One mode per environment: `PAYMENT_GATEWAY_MODE` = `fake` (default) | `sandbox` | `live`.

## UMK-2019: onboarding

### payment-api
- **Tables** (schema `payment`, RLS, `tenant_id`, covered by the runtime purge):
  `merchant_accounts` (one per `(tenant_id, provider)`: mode, status, reason, the gateway's sub-account id, the
  draft, terms time, `enabled_methods`), `merchant_account_events` (audit: one row per status change and per
  toggle), `merchant_webhook_events` (inbox: once per `(provider, event_id)`; **the body is not stored**, a real
  gateway's may carry personal data).
- **Statuses**: `not_submitted`, `submitted`, `needs_fix`, `rejected`, `verified`, `active`, `suspended`.
  One place changes it (`MerchantsService`, under `select … for update`), by `src/merchants/transitions.ts`:
  - owner: `not_submitted → submitted` (submit), `needs_fix → submitted` (submit again),
    `verified → active` (first method on), `active → verified` (last method off);
  - gateway (pending → `submitted`, needs_fix, rejected, verified → `verified` or `active` by the toggles,
    suspended): from any status but `not_submitted`. Toggles survive a suspension.
- **A webhook is never trusted** (as for payments): `POST /webhooks/:provider/accounts` (no service key; the
  adapter checks the signature, 401) stores the event once and then **reads the status from the gateway**. So a
  repeated event changes nothing and an old event delivered late lands on the gateway's current status. The
  tenant comes from our row. The reconciliation tick also asks about accounts waiting on the gateway and retries
  failed events.
- **Contract** `src/adapters/onboarding.ts` (`ONBOARDING_ADAPTERS`), provider-neutral (UMK-2019 "Keep the
  contract provider-neutral"): `createAccount` (idempotent on our account id; called again with the corrected
  draft after `needs_fix`), `verificationLink?`, `getAccountStatus`, `handleAccountWebhook`, plus what the
  adapter declares: `modes`, `methods` (the methods it serves for a store's account: toggles exist only for
  these) and `verification`:
  - `hosted` (Xendit Managed, OY!; the fake): the owner verifies on the gateway's page through the link, and
    **no identity document reaches the POS or payment-api**;
  - `platform` (DOKU): the platform registers the sub-account, no owner step, no link (409
    `verification_not_hosted`);
  - `own_keys` (Midtrans and most others): the store's own keys. **Designed, not built**: the column
    `merchant_accounts.credentials_encrypted` exists and nothing writes, reads or answers it; submitting an
    account of an `own_keys` adapter is refused (409 `verification_unsupported`).
  All modes map to the same seven statuses. The gateway's account reference is an opaque string.
- **A charge answers a QR string or a hosted payment URL**: `checkout` is `{ qrString }`, `{ paymentUrl }` or
  `{ vaNumber, bank }` (documented in `src/adapters/adapter.ts`). The fake gains the method `fake_checkout`,
  which answers a `paymentUrl`, next to `fake_qris` and `fake_va`.
- **Fake gateway**: sub-accounts in memory, the four contract calls, and controls under `/dev/fake-gateway`
  that approve, ask for a fix, reject, suspend, and resend a notification; each delivers a signed notification
  through `MerchantWebhooksService.receive`, the call the webhook route makes.
- **Modes**: `PAYMENT_GATEWAY_MODE` and `PAYMENT_LIVE_ENABLED` (default off). Boot is refused with mode `live`
  and the switch off. An account records the mode it was created in; submit and charge are refused
  (`live_disabled`) for live while the switch is off, and a charge is refused when the account's mode is not the
  environment's (`merchant_mode_mismatch`).
- **Charge gate** (`PaymentsService.charge`, online adapters only, a new charge only: a replay of a key still
  answers the first payment): 409 `merchant_not_active` (meta `status`), `method_disabled`, `live_disabled`,
  `merchant_mode_mismatch`. CASHAC is never gated. Switching a method off does not touch a waiting payment.
- **Secrets**: the gateway's sub-account id and every signing secret stay in payment-api; no route answers them.

Service routes (all need `X-Payment-Service-Key`, tenant from `X-Tenant-Id` only):

| Route | Body | Answer |
| --- | --- | --- |
| `GET /merchant-accounts` | | `{ mode, items: Account[] }`: one per onboarding provider of this environment; `not_submitted` when the store has none |
| `PUT /merchant-accounts/:provider` | `{ businessType?, businessName?, email?, phone? }` (a draft: each may be null) | `Account`; 409 `merchant_locked` unless `not_submitted` or `needs_fix` |
| `POST /merchant-accounts/:provider/submit` | `{ termsAccepted: true, actorRef }` | `Account` (`submitted`); idempotent; 409 `draft_incomplete` (meta `missing`), `merchant_locked`, `live_disabled`, `mode_unsupported`; 503 `gateway_unavailable` (the account stays `submitted` and the call is repeated) |
| `POST /merchant-accounts/:provider/verification-link` | | `{ url, expiresAt }`; 409 `verification_not_open` unless `submitted` or `needs_fix` |
| `POST /merchant-accounts/:provider/sync` | | `Account` after asking the gateway |
| `PUT /merchant-accounts/:provider/methods/:method` | `{ enabled, actorRef }` | `Account`; 409 `merchant_not_verified` unless `verified` or `active`; 422 unknown method |
| `POST /webhooks/:provider/accounts` | the gateway's bytes | `{ received, duplicate }`; 401 `invalid_signature` |

`Account` = `{ provider, mode, status, statusReason, verification, profile: { businessType, businessName, email,
phone }, termsAcceptedAt, submittedAt, methods: [{ method, enabled, chargeable }], lastSyncedAt, updatedAt }`.
An unknown `:provider` answers 404.

Fake controls (service key + tenant header; the account is the header tenant's, 404 when it has none):
`GET /dev/fake-gateway/account`; `POST …/account/approve|needs-fix|reject|suspend` with
`{ reason?, webhook?: send|drop|duplicate }` (`reason` required for needs-fix, reject, suspend; 409
`account_not_reviewable`); `POST …/account/webhook { eventId? }`; `POST …/accounts/outage { down }`.

### pos-api (`src/payments-client/`, through `payments.client.ts` only)
All but the last need `payments.manage`; tenant from the session; bodies validated (422, Indonesian).

| Route | Body | Answer |
| --- | --- | --- |
| `GET /online-payments` | | `{ enabled, mode, accounts: Account[] }` (`enabled: false`, no accounts, when payment-api is off) |
| `PUT /online-payments/:provider/draft` | `{ businessType, businessName, email, phone }` (each optional or null) | `Account` |
| `POST /online-payments/:provider/submit` | `{ termsAccepted: true }` | `Account` |
| `POST /online-payments/:provider/verification-link` | | `{ url, expiresAt }` |
| `POST /online-payments/:provider/sync` | | `Account` |
| `PUT /online-payments/:provider/methods/:method` | `{ enabled }` | `Account` |
| `GET /online-payments/methods` (`sales.create`) | | `{ methods: string[] }`: what the cashier may offer now |

A refusal of payment-api keeps its status and `code`, with an Indonesian message; no clear answer is 503.

## UMK-2021: `payments.manage` and the default Admin role
- `payments.manage` in `PERMISSIONS`; label in pos-web `PERMISSION_LABELS`.
- `DEFAULT_ROLES` gains `Admin` = every permission but `ADMIN_EXCLUDED_PERMISSIONS`.
- A data migration gives every store that already has roles, and no role named Admin, the Admin role with that
  set (a snapshot of the constant at this commit; a test compares the two).

## UMK-2022: device pairing code (extends `src/staff`, the devices module)
- `POST /auth/device/pairing` (public, the signed-out device): `{ pairingToken, code, expiresIn }`. The code is 6
  digits; only its SHA-256 is stored, and the SHA-256 of the token's secret. At most `MAX_LIVE_PAIRINGS` codes are
  open at once (429 otherwise).
- `POST /staff/devices/pair` (`staff.manage`, the owner's own session): `{ code, name }` → `{ device }`. Binds the
  device to **the session's store**, uses the code up, and never answers the device token. A wrong, used or
  expired code answers 422; wrong codes lock the store's pairing as PIN sign-in does (429 with `Retry-After`).
- `POST /auth/device/pairing/status` (public): `{ pairingToken }` → `{ status: 'pending' }` or
  `{ status: 'paired', deviceToken, device }`; 404 for an unknown, expired or revoked one. The device's secret is
  the one it was handed at the start, so the token never passes through the owner's device.
- Revoking the device ends its sessions (existing behaviour, proven for a paired device too).
- Tables `pos.device_pairings` (`tenant_id` null until the owner claims it: the device has no store before) and
  `pos.device_pairing_attempts`, both RLS and purged.

## Definition of Done
- `[test]` payment-api `test/merchants.e2e-spec.ts`: the whole flow on the fake (draft, submit, link, approve,
  toggle, active); needs-fix and submit again; reject; suspend and reinstate; webhook delivered twice changes
  nothing; an old event delivered late lands on the current status; a dropped webhook is found by the
  reconciliation; a forged signature is 401; the gateway down at submit answers 503 and the repeat succeeds.
- `[test]` charge refused per status (each of the six non-active ones and no account) and per toggle; allowed when
  active and on; a replay after a suspension still answers the first payment; a waiting bill is still paid after
  its method is switched off; CASHAC never gated.
- `[test]` live refused: boot (`config.spec.ts`), submit and charge.
- `[test]` no answer of any merchant or control route carries the sub-account id or the signing secret; pos-api's
  answers neither.
- `[test]` cross-tenant: store B cannot read, change, toggle or drive store A's account (payment-api and pos-api).
- `[test]` purge deletes the three new tables' rows of the tenant and leaves the others (payment-api
  `test/purge.e2e-spec.ts`, whose guard still requires `tenant_id` on every table).
- `[test]` `src/merchants/transitions.spec.ts`: the move table.
- `[test]` pos-api `test/online-payments.e2e-spec.ts` against the real payment-api with the fake: the flow, 403
  without `payments.manage` (also for the default Admin role), 422 on bad bodies, cross-tenant, payment-api off.
- `[test]` pos-api `test/staff.e2e-spec.ts`: `Admin` seeded with the constant's set; the backfill migration adds
  it to a store that has roles, once, and leaves an existing "admin" role alone.
- `[test]` pos-api `test/device-pairing.e2e-spec.ts`: pair and sign in by PIN; the code is single use; expired;
  only the hash is stored; lockout after 5 wrong codes with backoff, per store; the code is refused from a
  signed-out caller and without `staff.manage`; the paired device belongs to the session's store only
  (cross-tenant); revoke ends the device's sessions and its token; the status route never answers another
  pairing's token.
- `[test]` revert-red, once each: the charge gate, the webhook signature check, the single-use claim.
- `[cmd]` `npm run lint && npm run typecheck && npm run build`; payment-api `PAYTEST_DB=pay_onb npx jest
  --runInBand`; pos-api `PGTEST_DB=pos_onb PAYTEST_DB=pay_onb npx jest --runInBand`; pos-web vitest.
- `[manual]` owner: the Admin permission set, the 10-minute lifetime, the draft fields (assumptions above).
- `[qa]` none yet: no screen.

## Files
- payment-api: `src/adapters/onboarding.ts`, `src/adapters/adapters.module.ts`, `src/adapters/fake/*`,
  `src/merchants/{transitions,merchants.service,merchant-webhooks.service,merchants.controller,merchants.schemas}.ts`,
  `src/db/schema/merchants.ts`, `src/config.ts`, `src/payments/{payments.service,payments.controller,reconciliation.service}.ts`,
  migration `drizzle/0002_merchant_accounts.sql`, tests above, `test/support/{fixtures,merchants}.ts`.
- pos-api: `src/payments-client/{payments.client,online-payments.controller,payments.module}.ts`,
  `src/staff/{permissions,devices.controller,device-pairing,staff.module}.ts`, `src/db/schema/staff.ts`,
  migrations `0030_admin_role_backfill.sql`, `0031_device_pairings.sql`, tests above.
- pos-web: `src/routes/staf/-api.ts` (one label). `CLAUDE.md`, `.env.example`, `commitlint.config.js` (scope `devices`).

## Not built (and why)
- A real gateway adapter, sandbox and live (legal gate UMK-1977). The design's rule "one test payment and one test
  refund in sandbox before a store goes live" needs a sandbox and is not built.
- Verification modes `platform` and `own_keys`: named in the contract; `own_keys` has its column and its
  refusal, and no adapter. Encrypting per-store keys (key management, rotation) is designed when a store asks.
- Closing the sub-account at the gateway when a store is erased: the purge deletes payment-api's rows; the
  gateway side follows the provider's rules and is a separate step (design).
- Every screen (Pembayaran Online, the pairing screens), admin invitations (UMK-2023/2024).
