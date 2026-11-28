# UMK-2131: setup checklist v2 and activation metrics

Linear: UMK-2131 (onboarding, owner approved 2026-11-28; research doc "Wawancara UMKM", design 40 board).

## Goal

"Kelengkapan toko" tells a new owner what is left and why, and the product team can see, per store and without
personal data, how fast stores reach their first sale and whether they keep selling and record costs.

## Decisions

- Four new steps: `owner_pin` (the owner's approval PIN, read through `VoidPins.ownerHasPin`, the one reader of
  `void_pins`), `stock_in` (any stock batch), `first_sale` (a sale in `FINAL_SALE_STATUSES`) and `cashier` (a live
  staff member, `optional`). Each step carries `why`, one Indonesian line. `complete` needs only the required steps,
  so a store with no staff still sees the board disappear.
- "Has a cost" = `cost_price > 0` (the convention of the products summary's `noCost`). To read the share on day 7
  later, `products.cost_set_at` records when the cost first went above 0. One trigger keeps it on every write path
  (catalog, import, purchases, agent); a cost set back to 0 clears it. Existing costed products are backfilled with
  their creation time.
- Metrics are not served over HTTP (no new key, no new route to guard): `npm run metrics:activation -w pos-api`
  prints JSON per store (`ageDays`, `minutesToFirstSale`, `salesDaysFirstWeek`, `costSharePercentDay7`) and the
  medians. No tenant id, user id or name. A figure whose 7-day window is still open is null. Sales are dated by
  `paid_at`; days are the store's own timezone.

## Definition of Done

- [test] `GET /summaries/setup` lists the 8 steps with links and `why`; owner PIN, stock-in and first sale tick
  their steps; the board completes without a cashier; store B's PIN does not tick store A's board
  (`test/summaries.e2e-spec.ts`).
- [test] The trigger stamps, keeps and clears `cost_set_at` (`test/activation.e2e-spec.ts`).
- [test] The report computes minutes to first sale, sales days in week one, day-7 cost share (deleted and later
  products left out), nulls for open windows, and carries no id (`test/activation.e2e-spec.ts`).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.

## Files

- `apps/pos-api/src/summaries/summaries.{service,controller}.ts`, `src/void/void-pin.ts` (`ownerHasPin`).
- `apps/pos-api/src/onboarding/activation.ts`, `package.json` script.
- `apps/pos-api/src/db/schema/catalog.ts`, `drizzle/0054_products_cost_set_at.sql` (column, backfill, trigger).
- `apps/pos-web/src/routes/ringkasan/-{api.ts,panels.tsx}`: the board shows the `why` line and "(opsional)".
