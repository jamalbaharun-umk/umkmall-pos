# UMK-1924 U8b: the POS purges a store when UMKMall erases the account

POS half of epic unit U8 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). The UMKMall half (calling this
from account erasure) is the monorepo session `u8a-erasure`; this unit builds to its contract and does not change it.

## Goal

When UMKMall erases an account, it calls the POS once (or again, on retry), and every row and image that belongs to
that user's store is gone. Afterwards UMKMall can delete its `public.users` row: the `ON DELETE RESTRICT` FK from
`pos.tenants` no longer blocks it.

## Contract (fixed)

`POST /internal/tenants/purge`, public to the session guard, authenticated by header `x-pos-service-key` compared
timing-safe to env `POS_SERVICE_KEY` (wrong or missing → 401, standard Indonesian error shape). Body
`{ "userId": "<uuid>" }` through `validate()` (bad → 422). Idempotent: `200 { "purged": true }` when a store was
deleted, `200 { "purged": false }` when the user had none.

## Behaviour

- Tables are discovered at runtime from `pg_catalog`: every table in schema `pos` with a `tenant_id` column, and
  the FK edges between them. They are deleted children before parents (topological order; a cycle is a bug and
  throws), `delete … where tenant_id = $1` each, then the `pos.tenants` row, in ONE transaction. A new table is
  covered without touching this code, as long as it has `tenant_id` (guard below).
- Images: the tenant's prefix `tenants/<tenantId>/` is deleted through the storage adapter
  (`ObjectStorage.deletePrefix`, added with `LocalDiskStorage`), retried 3 times. **Order: images first, then the
  database transaction.** If the images cannot be deleted the call answers 503 and the rows stay, so UMKMall's
  retry finds the tenant again and finishes. Deleting files after the commit would, on a storage failure, leave
  images with no row pointing at them and nothing to retry from. (Ruling, deviates from the brief's
  "after commit": same outcome on success, no orphaned files on failure.)
- Logs: tenant id and error class only; never names, phones or the service key.
- `pos.handoff_jtis` is not touched: jti + expiry only, no user or store.

## Definition of Done

- [test] guard: every `pos` table except `tenants`, `handoff_jtis` (and the migrations journal) has `tenant_id`.
  Revert-red once with a fake table.
- [test] purge: a store seeded across catalog + images, stock, shift, sale, member, voucher, credit sale + payment,
  supplier + approved PO, opname, staff/role/device/session/PIN attempt, settings → every tenant table had rows for
  it before (asserted) and has zero after; no files under its prefix; a second store is untouched (rows and
  image); a second call answers `purged: false`; deleting the `public.users` row then succeeds.
- [test] wrong key → 401, missing key → 401, bad body → 422.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green; CI green on `main`.
- [manual] not exercised: UMKMall's caller (`u8a-erasure`) and a production object store (only `LocalDiskStorage`
  exists).

## Files

`apps/pos-api/src/purge/` (controller, service, module), `src/catalog/storage.ts` (`deletePrefix`),
`app.module.ts` (one line), `test/purge.e2e-spec.ts`.
