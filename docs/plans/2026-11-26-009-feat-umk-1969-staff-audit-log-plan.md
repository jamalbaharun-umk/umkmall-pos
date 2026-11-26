# UMK-1969: staff audit log and cashier session-end redirect

Design feature 32 "Log staf" (approved). Epic UMK-1924.

## Goal

The owner sees who did what and when for everything that touches money and access. A cashier whose session ends is
sent to `/kasir/masuk` with a clear message, the cart kept (it lives in sessionStorage).

## Definition of Done

- [test] `pos.audit_log` (RLS, tenant_id, purge-discoverable) written by `recordAudit(tx, ...)` inside the action's transaction; a rolled-back action writes no row (test/audit.e2e-spec.ts).
- [test] Exactly one row, with the right actor, target and details, for each event in `src/audit/events.ts`; no PIN, token, phone number, customer name or note stored (e2e grep + scrub unit tests).
- [test] `refund_manual` and `refund_retry` are written before the payment-api call (test/pg-cashier-flow.e2e-spec.ts, V4).
- [test] Append only: no mutating route; a trigger refuses UPDATE, DELETE and TRUNCATE; the purge deletes a store's rows (and only that store's) through `pos.purging`.
- [test] `GET /audit-log` filters (group, event, actor, days, from/to in the store timezone), paging, 403 without `staff.manage`, cross-tenant 404, unknown stored timezone answers the default.
- [test] pos-web pure logic (`-log-helpers.test.ts`).
- [qa] Pengaturan, Log aktivitas at 375 and 1024: loading, empty, no-result, error dialog, "Muat lagi"; touch targets at least 44 px.
- [manual] Cashier session end redirect shows the message (screen checked; the 401 itself not driven end to end).

## Files

`apps/pos-api/src/audit/`, `db/schema/audit.ts`, `drizzle/0046_audit_log.sql`, one-line call sites (sales, shifts, void, staff, purge); `apps/pos-web/src/routes/pengaturan/log-aktivitas.tsx` (+ `-log-api.ts`, `-log-helpers.ts`), `nav.ts`, `kasir/masuk.tsx`, `lib/api.server.ts`.

## Decisions

Reuse `staff.manage` (Pemilik only by default) instead of a new permission. Owner sign-in and failed PINs are not recorded (not in the design's list). Notes are never copied. Retention (2 years, then archive) and export (none) await the owner's decision.
