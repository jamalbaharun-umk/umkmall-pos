# UMK-1945 — POS owner sign-in from the shared UMKMall cookie

Linear: **UMK-1945** (blocked by UMK-1947 in the monorepo). Replaces the U1 handoff-token sign-in, whose UMKMall side
was reverted (UMKMall/umkmall#1837 → #1845). Owner decision 2026-11-20: share UMKMall's login cookie across
`.umkmall.id` (UMK-1947) instead.

## Goal

An owner signed in to UMKMall opens the POS and lands on the dashboard without a second sign-in. pos-web forwards
only UMKMall's `auth_token` and `auth_refresh` cookies to pos-api `POST /auth/umkmall/session`, which asks
`GET ${UMKMALL_WEB_URL}/api/auth/me` (5 s timeout) who they are:

- 200 → `findOrCreateTenant(user.id)` → 15-minute owner session;
- 401 → 401; pos-web sends the browser to `${UMKMALL_WEB_URL}/login?next=<POS URL>` (POS host only);
- timeout, network error or 5xx → 503.

Every `Set-Cookie` from `/auth/me` goes back to the browser unchanged (pos-api → pos-web → browser): `/auth/me` can
renew the access cookie and mint the refresh cookie once, and dropping it signs the owner out of UMKMall later.

The owner refresh (on a 401 from pos-api) repeats the same check, replacing `/auth/refresh` and the `isLive` liveness
call, so a revoked UMKMall session or an account being deleted loses the POS within 15 minutes.

Removed: `POST /auth/umkmall/exchange`, `POST /auth/refresh`, `verifyHandoff` + JWKS, the `sid` claim,
`UMKMALL_JWKS_URL`, `UMKMALL_API_URL`, the `handoff_jtis` table (migration), `/masuk/umkmall`. Kept:
`POST /auth/dev/sign-in` (localhost, refused in production), `POS_SERVICE_KEY` (purge).

## Definition of Done

- [test] pos-api: 200 → session, store created once; 401 → 401; 5xx, timeout, unreachable → 503; only the two auth
  cookies reach UMKMall; every `Set-Cookie` from `/auth/me` is on the response; no auth cookie → 401 without a call.
- [test] pos-web: `Set-Cookie` from pos-api relayed to the browser; the UMKMall login URL's `next` stays on the POS
  host (absolute, protocol-relative and backslash paths fall back to `/`); owner 401 on refresh → redirect to login.
- [test] `handoff_jtis` is gone; the existing dev sign-in tests stay green.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
- [manual] Not done here, waits for UMK-1947: live test on `pos.preview.umkmall.id`.

## Files

- `apps/pos-api/src/auth/auth.controller.ts`, `src/auth/umkmall.ts` (the `/auth/me` call), `src/tenancy/session.ts`,
  `src/config.ts`, `src/db/schema/{handoff-jtis.ts,index.ts}`, a new drizzle migration, `test/auth.e2e-spec.ts`,
  `test/purge.e2e-spec.ts`, `test/support/env.ts`.
- `apps/pos-web/src/lib/{session.server.ts,api.server.ts,sign-in.ts}` (+ tests), `src/routes/index.tsx`,
  `src/routes/masuk/*`, `src/routes/keluar.ts`.
- README, CLAUDE.md, `.env.example`.

## Known gap

UMKMall's login only follows a same-origin `next` (`apps/main-website/lib/safe-next-path.ts`), so after signing in
the owner lands in UMKMall, not back in the POS, until UMKMall allows the POS host there.
