# UMK-1924 U4: staff accounts, roles and the price override permission

Epic unit U4 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). Ported from Lakasir's tenant `User`/`Role`
models, `UserResource`/`RoleResource`/`PermissionResource` and `PermissionSeeder` (spatie/permission), with its
flaws fixed (lakasir-findings.md 3: no permission gate on the price override).

## Goal

The owner creates cashiers (name + PIN) and roles with permissions, and binds a cashier device to the store.
On a bound device a cashier picks their name and enters a PIN and gets a cashier session. Wrong PINs lock that
cashier in that store with growing backoff. The owner can revoke a device or a single cashier session, and the
revocation takes effect on the cashier's next request. Other units gate actions with
`@RequirePermission('<key>')`; U3 uses `sales.price_override` for the override sale itself.

## Settled (not changed here)

Cashiers are local POS users, never UMKMall accounts. Device-bound PIN sign-in, lockout per store + cashier with
backoff, owner revokes a device or a cashier session.

## Design

- **Permissions** are a code-defined list (`src/staff/permissions.ts`): `sales.create`, `sales.price_override`,
  `catalog.manage`, `reports.view`, `staff.manage`. Lakasir stores permissions as DB rows per guard; here a key not
  in the list is refused with 422.
- **Roles** per tenant, name unique per tenant. A tenant with no roles gets `Pemilik` (every permission) and
  `Kasir` (`sales.create`) seeded on first use (insert … on conflict do nothing, so a concurrent first use is safe).
- **Staff**: name, PIN hash (Node `crypto.scrypt`, per-PIN salt, no new dependency), active, soft delete
  (`deleted_at`; Lakasir uses SoftDeletes too). PIN is 4–8 digits. Staff ↔ roles many-to-many; a cashier's
  permissions are the union of their roles' permissions.
- **Devices**: name, SHA-256 of a 32-byte random secret (high entropy, so a fast hash is enough), `revoked_at`.
  Binding returns `deviceToken = <deviceId>.<secret>` once; the device sends it as header `X-Pos-Device`.
- **Cashier sessions** (`staff_sessions`): one row per PIN sign-in (staff, device, expires, revoked_at). The token
  is signed in `src/tenancy/session.ts` with `kind: 'cashier'`, `sub` = staff id, and a new optional claim
  `csid` = session row id (additive; U1b's owner `sid` is the UMKMall session and stays separate). TTL 12 hours
  (one shift); cashiers do not refresh.
- **Liveness and permissions per request**: the global session guard, for a cashier token, loads the session row
  and requires it unrevoked and unexpired, its device unrevoked, the staff active and not deleted; it then loads
  the staff's permissions. So a revoke, a deactivation or a role change applies on the next request, not at token
  expiry. Owner sessions hold every permission implicitly. The permissions land on `PosSession.permissions`.
- **Lockout** (`pin_attempts`, key tenant + staff): sign-in runs in a transaction holding `select … for update`
  on that row, so parallel guesses are serialized. 5 failures → locked 30 s, doubling per further failure, capped at
  15 min; a locked cashier gets 429 with `Retry-After` and the PIN is not even checked. Success resets.
  Unknown staff id, wrong PIN and inactive staff all answer the same 401.
- **Revocation**: revoking a device also revokes its sessions; deleting or deactivating staff revokes theirs.
- **Routes** (owner, or a cashier holding `staff.manage`): `GET/POST /staff`, `GET/PATCH/DELETE /staff/:id`,
  `GET/POST /roles`, `GET /roles/permissions`, `GET/PATCH/DELETE /roles/:id`, `GET/POST /staff/devices`,
  `POST /staff/devices/:id/revoke`, `GET /staff/sessions`, `POST /staff/sessions/:id/revoke`.
  Device routes (public, `X-Pos-Device`): `GET /auth/device/staff` (name picker: id + name of active staff),
  `POST /auth/pin` `{ staffId, pin }` → `{ sessionToken, expiresIn, staff, permissions }`.
- A non-UUID id answers 404 (it is no row of this store); bad bodies answer 422 (zod).
- PINs, device secrets and hashes are never returned (except the device token once at binding) and never logged.

## Definition of Done

- [test] CRUD staff, roles, devices; cross-tenant: store B gets 404 on store A's staff, role and device ids for
  read, update, delete and revoke; B's lists never show A's rows.
- [test] PIN wrong 5 times → 429 with `Retry-After`, even with the right PIN; the backoff doubles on the next
  failure. Revert-red once: remove the lock check, the test fails, restore.
- [test] revoked device → `POST /auth/pin` 401 and its live cashier sessions → 401 on the next request.
- [test] a revoked cashier session → 401; deactivating staff ends their session.
- [test] cashier without `staff.manage` → 403 on staff, role and device routes; with it → 200.
- [test] `@RequirePermission('sales.price_override')` → 403 for a cashier without it, 200 with it and for owners
  (guard spec on a test-only controller).
- [test] no response body contains the PIN or its hash; no `Logger` call in `src/staff` takes the PIN.
- [test] new tables have RLS (existing `db.e2e-spec.ts`).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green; CI green on `main`.
- [manual] pos-web: staff list/form, roles + permissions, device binding, cashier PIN screen (name picker + PIN
  pad), Indonesian, loading/empty/error states, UMKMall token styling, no `@umkmall/*`.
- [manual] not exercised: the price-override sale (U3), a real device in a shop.

## Files

- `apps/pos-api/src/staff/` (module, controllers, service, permissions, `require-permission.ts`, PIN/secret hashing).
- `apps/pos-api/src/db/schema/staff.ts`, one line in `db/schema/index.ts`, one migration.
- `apps/pos-api/src/tenancy/session.ts` (optional `csid` claim, `permissions` on `PosSession`),
  `src/tenancy/session.guard.ts` (cashier liveness hook), one line in `app.module.ts`.
- `apps/pos-api/test/staff.e2e-spec.ts`, `test/support/fixtures.ts` (cashier fixture).
- `apps/pos-web/src/routes/staf/…`, `src/routes/kasir/…` (after U1b's `api.server.ts` is on `main`).
- `CLAUDE.md` Rules: `@RequirePermission`.

## Not in this unit

The override sale (U3); a staff audit log; per-device staff restriction; owner-only device binding (a cashier with
`staff.manage` can bind devices, as they can already grant themselves any permission).
