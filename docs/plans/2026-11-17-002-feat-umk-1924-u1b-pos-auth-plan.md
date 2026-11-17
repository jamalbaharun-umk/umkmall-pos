# UMK-1924 U1b: the POS accepts the UMKMall handoff and keeps an owner session

POS half of epic unit U1 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). The UMKMall half (handoff token,
JWKS, liveness) is monorepo PR UMKMall/umkmall#1837; this unit builds against its contract and does not change it.

## Goal

An owner who arrives from UMKMall with a handoff token gets a 15-minute POS owner session in an httpOnly cookie
and sees an empty store dashboard. The store (tenant) is created the first time a UMKMall user arrives. The
session is renewed only while UMKMall says the UMKMall session is still live.

## Contract (from #1837, fixed)

- Handoff token: JWT, `alg: EdDSA` (Ed25519), header `kid`; `iss "umkmall"`, `aud "pos"`, `sub` = UMKMall
  `users.id`, `sid` = UMKMall auth session id, `jti` (uuid), `iat`, `exp` (≤ 300 s after `iat`, may be shorter).
- JWKS: `GET {API}/.well-known/pos-jwks.json`, `max-age=300`, may be `{ keys: [] }`. Unknown `kid` → refetch once.
- Liveness: `POST {UMKMALL_API_URL}/auth/pos/liveness`, header `x-pos-service-key`, body `{ sid }` →
  `200 { live }`. Anything but `200 { live: true }` is not live.

## Behaviour

- `POST /auth/umkmall/exchange` (public), body `{ token }` (zod; bad shape 422). Verify with `jose`
  `createRemoteJWKSet(UMKMALL_JWKS_URL)` (refetches on unknown `kid`). In one transaction: insert the `jti` into
  `pos.handoff_jtis` (a conflict → 401), find or create the tenant for `sub`. Answer
  `{ sessionToken, expiresIn: 900, tenant: { id } }`. Any verification failure → 401, never the reason.
- Owner sessions carry `sid` (optional claim; U4 cashier sessions have none).
- `POST /auth/refresh` (owner session with `sid`): liveness call with a 5 s timeout. `live: true` → fresh
  15-minute session; `live: false` → 401; timeout, network error or non-200 → 503. No new session on 503.
- `POST /auth/dev/sign-in` (public, local only): 404 when `NODE_ENV=production`. Body `{ userId }` (an existing
  `public.users` id); creates the tenant on first sight, issues an owner session without `sid` (cannot refresh).
- Token verification stays in `src/tenancy/session.ts` (the guard test's single allowed file); no guard change.
- `pos.handoff_jtis` has no `tenant_id`: a `jti` is spent before a tenant exists and identifies no store.
  Expired rows are deleted inside the exchange. RLS on. Holds no personal data, so U8 purge need not touch it.

## pos-web

- `src/lib/session.server.ts`: cookie `pos_session` (httpOnly, SameSite=Lax, Secure in production, 15 min),
  read/set/clear, and the exchange call to `POS_API_URL`.
- `src/lib/api.server.ts`: `api(path, init)` for server functions: bearer from the cookie, on 401 refresh once and
  retry; refresh fails → clear the cookie and redirect to `/` (the sign-in page). U2/U4 build on this.
- `POST /masuk/umkmall` server route: form body `token` → exchange → cookie → 303 `/`; failure → 303 `/?gagal=1`.
- `POST /masuk/dev`: dev sign-in with `POS_DEV_USER_ID`, 404 in production.
- `/`: signed in → store dashboard shell (empty state); not signed in → "Masuk lewat UMKMall" page (error state
  for `?gagal=1`). Loading state via the router's pending component.

## Definition of Done

- [test] exchange happy path returns a session that `/tenant/me` accepts; a second exchange for the same `sub`
  reuses the tenant.
- [test] replayed `jti` → 401 (revert-red once: drop the jti insert, the test fails, restore).
- [test] wrong `aud`, wrong `iss`, HS256 instead of EdDSA, expired, unknown key → 401; bad body → 422.
- [test] refresh: `live: true` → new session carrying the same tenant; `live: false` → 401; UMKMall down → 503;
  cashier/no-`sid` session → 401. The service key header is sent.
- [test] dev sign-in refused (404) when `NODE_ENV=production`.
- [test] `handoff_jtis` has RLS (existing `db.e2e-spec.ts` covers every `pos` table).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green; CI green on `main`.
- [manual] local: dev sign-in in pos-web shows the dashboard shell; signed out shows the sign-in page.
- [manual] not exercised: the real UMKMall JWKS and liveness (until #1837 merges and deploys).

## Files

- `apps/pos-api/src/auth/` (controller, module), `src/tenancy/session.ts` (handoff verify, `sid` claim),
  `src/config.ts` (`UMKMALL_JWKS_URL`, `UMKMALL_API_URL`, `POS_SERVICE_KEY`), `src/db/schema/handoff-jtis.ts`,
  one migration, `app.module.ts` (one line), `test/auth.e2e-spec.ts`, `test/support/env.ts`.
- `apps/pos-web/src/lib/{session,api}.server.ts`, `src/routes/index.tsx`, `src/routes/masuk/{umkmall,dev}.ts`.
- `CLAUDE.md` Commands (dev sign-in).

## Not in this unit

Sign-out, the UMKMall-side link/relay (#1837 follow-up), login-CSRF hardening of `/masuk/umkmall` (the token is
single-use and bound to the UMKMall session that minted it).
