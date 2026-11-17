# UMK-1924 U5: reports and dashboard tell the truth

Epic unit U5 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). Ported from Lakasir's
`Api/Tenants/Transaction/DashboardController`, `SellingOverview` widget, `SellingReportService`,
`ProductReportService`, `CashierReportService`, `PurchasingReportService` and the Filament report pages, with the
flaws below fixed.

## Goal

The owner (or a cashier holding `reports.view`) sees on `/` today's / this week's / month's / year's revenue,
sales count and gross profit next to the same span of the previous period, and opens sales, product,
shift/cashier and purchasing reports for a date range in the store's timezone, on screen, printable, and as CSV.

## Lakasir behaviour and the bugs found (read from code)

- **Revenue and profit swapped** (lakasir-findings.md 5): `totalRevenue` returns `total_price − total_cost`,
  `totalGrossProfit` returns `total_price`.
- **Timezone unvalidated** → `Carbon::setTimezone(null|garbage)` throws → 500. Reports parse `start_date` without
  `required` on the API path → 500 when missing.
- **Previous period is wrong**: `calculatePercentageChange` queries from `start − 1 period` up to the *current*
  start, and for "today" the current window starts at `now()` (not midnight) before `startOfDay` repairs it.
- **Purchasing report** ignores the store timezone and sums batch values.
- Floats and `Number::format` strings in report payloads; no CSV (PDF via dompdf, print via `innerHTML` swap).

## Design

- **Own module** `apps/pos-api/src/reports/` (controller, service, schemas, csv). Reads only; every query
  filters `tenant_id = session.tenantId`. Every route `@RequirePermission('reports.view')`.
- **Store timezone**: new table `pos.report_settings` (`tenant_id` PK → tenants, `timezone` text, default
  `Asia/Jakarta`, RLS). `GET /reports/settings`, `PUT /reports/settings` (`catalog.manage`, same as the tax
  setting). A timezone is valid only if it is in `Intl.supportedValuesOf('timeZone')` (+ `UTC`); otherwise 422.
- **Day boundaries in Postgres**: a local date range `from..to` becomes
  `[from::timestamp at time zone tz, (to + 1)::timestamp at time zone tz)` — DST-correct, half-open, no JS date
  library.
- **Metric definitions** (asserted by name in tests):
  - `revenue` = Σ `sales.total` (what customers paid, after discounts, incl. tax).
  - `salesCount` = number of sales.
  - `cost` = Σ `sales.cost_total` (FIFO cost stored at sale time).
  - `tax` = Σ `sales.tax`; `discount` = Σ `sales.discount`.
  - `grossProfit` = `revenue − tax − cost`. Tax collected is owed, not earned; with tax 0 (the default) this is
    exactly revenue − cost. Owner may rule otherwise; the field is computed in one place.
  - No void/refund exists yet (U3 deferred); when it lands, reports must exclude voided sales.
- **Dashboard** `GET /reports/dashboard?period=today|week|month|year`: current window = start of the period in
  the store timezone (week starts Monday) up to now; previous window = the same length one period earlier
  (`start − 1 period` to `now − 1 period`), so "this week so far" compares with "last week to the same moment".
  Returns `{ period, timezone, current: Metrics, previous: Metrics }`; percentage is the client's arithmetic.
- **Reports** (`from`, `to` as `YYYY-MM-DD`, real calendar dates, `from ≤ to`, span ≤ 366 days; zod → 422):
  - `GET /reports/sales` — one row per sale line (receipt number, time, SKU, name, qty, unit price, line total,
    cost, gross profit) + totals (qty, gross sales, discount, tax, revenue, cost, grossProfit).
  - `GET /reports/products` — per product (SKU, name, qty, sales, cost, gross profit) + totals. Sale-level
    discounts are not spread across products; the totals row shows them.
  - `GET /reports/shifts` — per shift opened in range: cashier (staff name, or "Pemilik"), opened/closed, sales
    count, revenue, cost, gross profit, opening/expected/counted cash and the difference.
  - `GET /reports/purchasing` — approved purchase lines by approval time: supplier, date, product, qty, unit
    cost, line total + grand total.
  - Totals come from a SQL aggregate, never from the (capped) rows: rows cap at 5 000 with `truncated: true`.
  - **CSV**: `GET /reports/<kind>/csv` with the same query, `text/csv; charset=utf-8`, plain integer rupiah, a
    header row in Indonesian, a totals row; cells quoted, formula-leading characters (`= + - @`) neutralised.
  - **PDF**: not built — the screen has a print button (browser print to PDF), which is what Lakasir's
    "Print" did. A server PDF would add a headless renderer; not cheap.
- **pos-web**: `MetricWidgets` component (`routes/laporan/-dashboard-widgets.tsx`) that `ui-parity-a`'s
  dashboard page renders with one line; report pages `/laporan` (index, like Lakasir's Report page),
  `/laporan/penjualan`, `/laporan/produk`, `/laporan/shift`, `/laporan/pembelian`: date range form, Tampilkan,
  Cetak, Unduh CSV; `@umkmall/ui` + admin theme; Indonesian; loading, empty, error states. Timezone setting on
  `/laporan`. One line in the central nav config (owned by `ui-parity-a`).

## Definition of Done

- [test] known-sales fixture (three sales, two products, one discounted, one taxed) asserts `revenue`,
  `salesCount`, `cost`, `tax`, `grossProfit` exactly in integer rupiah, by field name (labels cannot swap:
  revenue ≠ grossProfit in the fixture).
- [test] slice check: 3 × Rp5.000 with cost Rp3.000 → dashboard `today.current.revenue` 15000, `grossProfit`
  6000, `salesCount` 1.
- [test] timezone boundary: a sale at 23:30 WIB counts on that WIB day, not the UTC day; changing the store
  timezone moves it.
- [test] previous-period compare: a sale backdated exactly one period lands in `previous`, not `current`.
- [test] bad input → 422: malformed date, impossible date (2026-02-30), `from > to`, span > 366 days, unknown
  period, bad timezone on PUT; missing dates → 422 (never 500).
- [test] product, shift and purchasing reports and their totals on the fixture; CSV has header, rows, totals and
  neutralises `=` cells.
- [test] cross-tenant: store B's reports and dashboard never include store A's sales/purchases; B's settings are
  its own.
- [test] cashier without `reports.view` → 403 on every route; with it → 200.
- [test] `pos.report_settings` has RLS (`db.e2e-spec.ts`).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` (`PGTEST_DB=pos_u5`); CI green on `main`.
- [manual] pos-web: widgets on `/`, `/laporan/*` pages render in the browser with loading/empty/error states,
  CSV downloads, compared with Lakasir's report screens at tokoa.localhost:8090.
- [manual] not exercised: voids/refunds (do not exist), multi-currency, server PDF, very large stores (row cap).

## Files

- `apps/pos-api/src/reports/` (module, controller, service, schemas, csv), `src/db/schema/reports.ts`, one line in
  `db/schema/index.ts` and `app.module.ts`, one migration.
- `apps/pos-api/test/reports.e2e-spec.ts`.
- `apps/pos-web/src/routes/laporan/…` (pages, `-api.ts`, `-dashboard-widgets.tsx`), one line in the nav config,
  one line on the dashboard page.
