# UMK-1972: dashboard widgets with charts (design feature 35)

Goal: the Dashboard (`/`) shows the state of the store as pictures, not lists: the main figure with its trend and its
change from the period before, three small tiles, and a card for each of: sales trend, sales by hour, how it was paid,
best sellers, low stock, receivables by age and expenses. Charts come from `@umkmall/ui` (`primitives/Charts`, owner
exception UMK-2074): primary-blue ramp for data, status colours only for warnings (low stock). Design: "Dashboard dengan
visualisasi data" (feature 35); it replaces feature 15. Owner rule 2026-11-26: dashboard widgets visualise data with
charts and compare day, month and year.

## Rulings taken here (design names them, or they follow from the rules)

- **Every number comes from pos-api.** The screen formats and draws; it never sums, divides or re-sorts a figure
  (average basket and every percent included). New API only where no report has the shape: `GET /reports/widgets/*`
  and `GET /reports/receivables/aging`, all behind `reports.view`, tenant from the session. Reused as they are:
  `GET /reports/profit-loss?period=month` (Pengeluaran bulan ini: `topExpenses` and `current.expenses`) and
  `GET /reports/receivables/summary` (customer count for the card's total line).
- **The metric is the reports' own:** final sales (`FINAL_SALE_STATUSES`) dated by `paid_at`, minus the voids done in
  the window (a void is a reversal on the day it is done), store timezone, integer rupiah. `sales` = revenue - tax, and
  `grossProfit` = revenue - tax - cost (gross profit excludes tax everywhere, owner ruling 2026-11-25). The hero is
  "Penjualan" without tax (the design says so), so it is not the sales report's `revenue` (tax inside) but equals the
  profit-loss report's "Hasil jualan (tanpa pajak)".
- **Comparison day, week, month, year:** one period control (Hari ini, Minggu ini, Bulan ini, Tahun ini) drives the hero,
  the three tiles and the trend card. Delta = current period so far against the same span of the period before (the
  existing `/reports/dashboard` rule); the trend draws 7 days, 8 weeks, 6 months or 3 years, its last bar being the
  current figures. Hourly, payment mix (today), best sellers (this week) and expenses (this month) are fixed as in the
  design.
- **Payment mix** is by payment method as the store named them; a kasbon sale is its method of kind kasbon. Parts are
  sales without tax and add up to the hero (same total as the period's sales), at most 5 parts, the rest `Lainnya`.
- **Receivables by age** use the kasbon report's store-date rule. A kasbon due today (0 days late) is in `1 sampai 7
  hari`, so the three late buckets add up to the summary's `dueRest` and all four to `totalRest`.
- **Low stock** is the products list's own filter (`stock=low|out`: tracked, live, on hand at or under the product's
  threshold; never-stocked counts as out). The bar's "dari N" is the last quantity received (never under the threshold
  or the on-hand): the schema keeps no maximum stock.
- **Segera kedaluwarsa is NOT built.** No table stores an expiry date (stock batches carry received date and cost only;
  purchasing has no field for it), so a card would be empty for ever. It needs a data change first: expiry date on a
  stock batch, entered at purchase and opening stock, FIFO unchanged. Reported on UMK-1972 as the follow-up.
- No permission to view reports: no card shows (the existing quick start remains). A card that fails shows its own error
  with "Muat ulang", the other cards stay, and the shared error dialog opens once ("Gagal memuat widget"). The screen only
  reads, so there is no success toast. No nav entry: Dashboard is already `/` in `nav.ts`.
- The older two cards of the first dashboard (`MetricWidgets`, `ReceivablesCard`) are replaced by this one; their
  loaders stay for the reports.

## Definition of Done

1. [test] Overview: sales and gross profit exclude tax (tax 10% sale: Rp15.000 sales, Rp6.000 profit); average basket by
   the server; yesterday as `previous`; the trend's last bucket equals `current` for every period (7, 8, 6, 3 buckets).
2. [test] A void is taken off on the day it is done (same-day nets to zero; a void of an older receipt is negative today);
   awaiting and cancelled sales are in no figure.
3. [test] Hourly: 08 to 20 always, wider when a sale falls outside, peak hour named, other days left out, voids taken off.
4. [test] Payment mix adds up to the overview's sales; kasbon is a part; a voided sale leaves its method; `Lainnya` after 5.
5. [test] Best sellers by units, ties by sales then name, limit 1 to 10 (422 otherwise), voided and older-week lines out.
6. [test] Low stock: out and low only, counts of all, never a service or a deleted product.
7. [test] Aging buckets 0..7 / 8..30 / over 30 on the store date; they add up to the kasbon summary.
8. [test] Cross-tenant: store B sees nothing of store A on every new route (revert-red once: drop one tenant filter);
   every route is 403 without `reports.view`.
9. [test] pos-web: the helpers that word the cards (delta words, hour labels, trend labels, bar rows capped at 5 and
   ordered as the server sent them, card state mapping, permission hiding).
10. [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
11. [qa] Playwright at 375 and 1024: all cards with data, a new store (empty states), one failing card (inline error plus
    dialog), the period control, loading skeletons; buttons one line and 44 px on a phone (`.ds-chart-btn` included).
12. [manual] Not exercised: dark theme, a real phone, a store with years of data.

## Files

- `apps/pos-api/src/reports/dashboard-widgets.{service,controller}.ts` (new), `receivables-report.service.ts` (`aging`),
  `reports.controller.ts` (route, module), `reports.service.ts` (`lineRows`, `bounds` public).
- `apps/pos-api/test/dashboard-widgets.e2e-spec.ts`.
- `apps/pos-web/src/routes/-dashboard/` (cards, loaders, wording helpers and tests), `routes/index.tsx` (mounts it).

## Tests to add

The e2e spec above; `-dashboard/-wording.test.ts` for the pure helpers.
