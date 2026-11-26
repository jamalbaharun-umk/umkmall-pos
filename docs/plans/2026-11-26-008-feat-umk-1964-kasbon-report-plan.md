# UMK-1964: kasbon (receivables) report, sales report split, dashboard card

Goal: the owner sees who still owes, how much and who is overdue (design fase 2, feature 28 "Laporan kasbon
(piutang)", approved). The sales report splits revenue into Lunas and Kasbon and shows "Piutang dibayar (uang
masuk)" apart from revenue; the dashboard shows "Piutang belum dibayar" linking to the report. Every number comes
from pos-api, from the receivables and the append-only receivable payment book. No charts (another worktree).

## Rules kept

- Remaining = kasbon total minus Σ its rows in `pos.receivable_payments` (the book), never a screen guess.
- A voided kasbon (`receivables.cancelled_at`) is in no list, no total, no CSV.
- Overdue by the store's calendar date (`report_settings.timezone`): days late = store today − due date, a date
  difference. A kasbon due today is due (0 days late); one due tomorrow is not. No due date = not due.
- "Piutang dibayar" = instalments (book rows other than the down payment, which is part of its sale) received in
  the range, minus the instalments a void done in the range gave back. The same figure is "Dibayar bulan ini".
  It is not revenue: revenue stays Σ sale totals, Lunas + Kasbon = revenue.
- "Dipegang penagih" = cash collectors took outside a shift minus their deposits (same rule as Setoran penagih).
  That cash already lowered the customer's remaining.
- CSV: UTF-8, `toCsv` prefixes cells starting with = + - @, no phone number, `reports.view`, at most 10,000 rows,
  beyond that 422 `EXPORT_TOO_LARGE`.
- Tenant from the session only; a member of another store answers 404.

## Definition of Done

1. [test] `GET /reports/receivables`: summary (total, due, paid this month, collector held, customer counts) and
   customers ordered by most overdue, filter `all|due|not_due`; design example kasbon Rp6.000, paid Rp2.500 →
   remaining Rp3.500.
2. [test] A voided kasbon leaves the report; its instalment no longer counts as paid in the void's range.
3. [test] Cash taken by a collector outside a shift lowers the remaining and shows as collector held until a
   deposit is received.
4. [test] Overdue boundary at store-timezone midnight (store zone whose date differs from UTC now); revert-red.
5. [test] `GET /reports/receivables/customers/:memberId`: open kasbon with their payments; 404 for another store.
6. [test] `GET /reports/receivables/csv`: columns, injection prefix (revert-red), no phone, `EXPORT_TOO_LARGE`.
7. [test] `GET /reports/sales` totals: `settledSales + creditSales = revenue`, `receivablePaid` apart.
8. [test] 403 without `reports.view`; store B sees an empty report and 404 on store A's member for every route.
9. [test] pos-web vitest for the pure helpers (status label, filter, empty texts).
10. [cmd] lint, typecheck, build, pos-web vitest, pos-api suites. [qa] Browser at 375 and 1024.

## Files

- `apps/pos-api/src/reports/receivables-report.service.ts` (new), `reports.controller.ts`, `reports.schemas.ts`,
  `reports.service.ts` (split figures in the sales report).
- `apps/pos-api/test/receivables-report.e2e-spec.ts` (new).
- `apps/pos-web/src/routes/laporan/kasbon.index.tsx`, `kasbon.$memberId.tsx`, `csv.kasbon.ts`, `-kasbon.ts`,
  `-kasbon.test.ts`, `-api.ts`, `-ui.tsx`, `-reports.ts`, `-dashboard-widgets.tsx`, `index.tsx`; `nav.ts` one line.

## Not built here

- "Kirim pengingat" (feature 34) and payment corrections (feature 31): other features; the detail links to the
  existing Piutang screen to take a payment.
- Charts.
