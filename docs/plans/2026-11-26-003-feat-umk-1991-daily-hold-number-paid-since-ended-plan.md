# UMK-2038, UMK-2046 follow-up: the hold number starts again every day; paid-since tells of every ended sale

Date: 2026-11-26. Epic UMK-1924, payment-api UMK-1991. pos-api only. Owner decisions of 2026-11-26 on the open
questions of [2026-11-26-002](2026-11-26-002-feat-umk-1991-hold-number-close-refusal-paid-while-away-plan.md),
built on top of it (PR 29).

## Goal

1. Hold numbers stay short: "Menunggu #n" starts at 1 every store day.
2. A till that was away learns of every waiting sale that ended meanwhile, not only of PG sales that were paid.
3. `number` of a waiting sale stays the hold number for now (pos-web stops reading it later): no change here.

## Decisions

### The hold number is per store day

- **The day is the store's day in `Asia/Jakarta`** (`HOLD_NUMBER_TIMEZONE`, one zone until stores carry their own).
- `sales_settings.hold_number_day` is the day `last_hold_number` counts in. `takeNumber(tx, tenantId, 'hold')`
  compares and writes it in the one upsert that takes the number, under the row lock the counter always had: a
  later day starts at 1, the same day goes on counting. Two sales at midnight cannot both take 1.
- A clock that went back (only a test can do that: the moment is the database's `now()`) does not start again:
  the count stays in the day the counter is in, so no number is given twice.
- `sales.hold_day` is the day a sale's hold number belongs to. Unique per `(tenant_id, hold_day, hold_number)`
  (the index on `(tenant_id, hold_number)` goes); a check says a hold number has its day.
- **Two waiting sales can now be called the same,** one of yesterday and one of today (a VA that lives past
  midnight, a cash sale held over an outage). Every answer that names a hold number also carries the sale's id and
  `createdAt`, and the routes take the id. The receipt number is not affected: it never starts again.
- The receipt counter knows no day.

### paid-since lists every ended sale

`GET /sales/paid-since` (paging, scope and `since` as in plan 002) now lists, by when pos-api wrote the end
(`endedAt`: `completed_at` or `cancelled_at`, both `clock_timestamp()`):

| what happened | `status` | `reason` | also |
| --- | --- | --- | --- |
| a PG sale was paid | `completed` | null | `onlinePayment: true` |
| ... and refunded since | `void` | null | |
| a cash/EDC sale was completed by the job | `completed` | null | `completedByJob: true`, `onlinePayment: false` |
| its QR or VA ran out | `expired` | `expired` | |
| the gateway said the payment failed | `cancelled` | `failed` | |
| someone at the till cancelled it | `cancelled` | `cashier` | |
| the store may not charge at the gateway | `cancelled` | `gateway_refused` | |
| no payment was ever recorded and the job gave it up, or the bill was closed otherwise | `cancelled` | `unpaid` | |
| cancelled before this change | `cancelled` | null | |

- **Not listed:** a cash/EDC sale completed by a request of the till (the sale itself, its repeat, or the
  cashier's switch to cash): the person at the till saw it. `sales.settled_by_job` tells them apart; it is set
  by `applyToSale` when the job (`reconcile`) completes a sale. So a switch to cash whose request died and that
  the JOB finished IS listed, with `completedByJob: true` (PR 31 review: the first text said no switched sale
  is). A PG sale is listed whoever learned of the payment.
- **`reason` is who or what made pos-api cancel, not the bill's last state.** A cancel by the cashier is
  `cashier` also when the bill had already expired at the gateway a moment before (payment-api answers the
  closed payment and the cancel route applies it). Harmless: the till that cancelled knows, and the sale is
  cancelled either way; a screen that must tell an expired QR from a cancelled one reads the payment's status.
- **`status` here is this answer's word,** not `sales.status`: `expired` is a sale whose status is `cancelled`
  and whose reason is `expired`. The sale's own status is unchanged everywhere else.
- `sales.cancel_reason` (`CANCEL_REASONS`) is written by `applyToSale` with the cancellation: `gateway_refused`
  when payment-api refused to bill the store, `cashier` for the cancel route, the payment's own `expired` or
  `failed`, else `unpaid`. A check allows a reason only on a cancelled sale.
- A cancelled sale has `receiptNumber: null`; its stock and voucher are back (as before).
- Each row also carries `cancelledAt` and `endedAt`. The cursor (`asOf`, `afterId`) is over `(endedAt, id)`,
  served by the index `sales_tenant_ended_idx` on `(tenant_id, coalesce(cancelled_at, completed_at), id)` (it
  replaces `sales_tenant_completed_idx`).
- **A cursor is never put inside the last 10 seconds** (PR 29 review). An end is stamped when it is written and
  seen when its transaction commits, so one still being written there can commit with an earlier time than a
  cursor and would be passed by for good. A page that would end there stops at the last sale that ended more
  than 10 seconds ago; the newer ones come with the page that ends the paging, whose `asOf` is 10 seconds behind
  the clock, so the next request reads them again. (More than a page of sales ended within those 10 seconds
  cannot be cut and is paged as it is.)

### Migration `hold_number_daily` (a new file; `sale_hold_number` is not edited)

- adds `sales.hold_day`, `sales.settled_by_job`, `sales.cancel_reason`, `sales_settings.hold_number_day`, the
  check `sales_hold_day_ck`; replaces the unique index. **`sales_hold_day_ck` carries two rules** despite its
  name: a hold number has its day, and only a cancelled sale has a `cancel_reason`. It is not renamed or split
  (that would be one more migration for a name); a refusal by it can be either rule
- existing hold numbers keep their number and are dated at the store day the sale was rung up (they were unique
  per store, so they are unique per store and day)
- a counter in use goes on counting today (`hold_number_day` = today) and starts at 1 tomorrow: a 1 taken today
  could meet a 1 of this morning
- **a sale that awaits payment loses the receipt number it was created with** (PR 29 review): the earlier
  migration let it keep one; it is not a receipt, and completing it now takes the next number. That number
  becomes a gap, once, for the sales that were waiting at the moment of the migration.
- Deploy: the same rule as plan 002's "Deploy order" (stop old instances, migrate, start new): the version before
  this one writes a hold number without its day.

## Definition of Done

- `[test]` the clock passes Jakarta's midnight (23:59:59.999 then 00:00:00): 1 on the new day, the count goes on
  before it; days later; a clock set back gives no number twice; a rollback gives the number back
- `[test]` many takes at once, on one day (also creating the row) and across midnight, and another store at the
  same time: no `(day, number)` twice, each day counted from 1
- `[test]` a sale still waiting from yesterday keeps its number while today's first is 1 again; both block the
  close and are told apart by id; yesterday's sale paid today takes the next receipt number
- `[test]` the database refuses a hold number without its day and a reason on a sale that is not cancelled
- `[test]` the migration: hold numbers dated by store day (23:30 UTC is the next day), the counter's day, the
  receipt number taken off waiting sales
- `[test]` paid-since: a cash sale completed by the job is listed, one completed at once or by a repeat is not;
  cancelled sales with each reason; `expired`; nothing after it all ended; paging over completed and cancelled
  sales that ended at the same instant; a cancelled sale is scoped like a paid one
- `[test]` the cursor carries microseconds (sales one microsecond apart across page ends); a page is cut before
  sales that ended just now, and they are read again after the last page
- `[test]` a sale held where it takes its number holds the close back: the close waits and is refused with it
- `[test]` revert-red: counting on over midnight, and dropping the job and the cancelled branch, fail their tests
- `[cmd]` lint, typecheck, build; pos-api `jest --runInBand` on its own databases

## Files

`apps/pos-api/src/db/schema/sales.ts`, `drizzle/NNNN_hold_number_daily.sql`, `src/sales/numbers.ts`,
`src/sales/sales.service.ts`, `src/payments-client/payment-sync.service.ts`, `test/sale-numbers.e2e-spec.ts`.

pos-web: only the two alerts for a waiting and a cancelled sale are removed from `routes/kasir/riwayat.$id.tsx`.
The screen loads the receipt, which pos-api now refuses for such a sale, so they could never show.

### The close refusal names the day (PR 31 review)

With daily numbers the refusal could read "#1, #1". The waiting sales are ordered by `(hold_day, hold_number)`,
the message says the day of a sale that does not wait since today ("#1 (25/11), #1"), and each item of `sales`
carries `holdDay`, `holdToday` and `holdDayLabel` (`DD/MM`, null for today).

## Not in this plan

- pos-web: a notice built from `paid-since`; reading `receiptNumber`/`holdNumber` instead of `number`; showing
  the day of a hold number when two waiting sales share one.
- A store timezone other than Asia/Jakarta.

## Open (owner)

1. Two waiting sales of different days can share a hold number. Show the day next to it on the waiting list, or
   is `createdAt` ("menunggu sejak ...") enough?
2. Should a sale the cashier cancelled at the till be left out of `paid-since` (they saw it), like a cash sale
   they completed? It is listed today, with `reason: 'cashier'`, so a supervisor's till hears of it.
