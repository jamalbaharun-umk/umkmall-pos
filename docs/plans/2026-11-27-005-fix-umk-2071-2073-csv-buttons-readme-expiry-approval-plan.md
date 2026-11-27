# UMK-2071 / UMK-2073 / UMK-2087 nit: CSV buttons, README shift rule, expiry at approval

## Goal

1. Untung rugi and Pengeluaran offer "Unduh CSV" for the period on screen (pos-api already serves
   `/reports/profit-loss/csv` and `/expenses/csv`).
2. The README states the kasbon cash shift rule as the code has it.
3. A purchase draft whose `expiresAt` elapsed after it was saved can still be approved.

## Definition of Done

- [test] `-csv.test.ts`: period query, file name, path map, refusal mapping.
- [cmd] `npx tsc --noEmit` and `npx vitest run` in apps/pos-web.
- [qa] Both screens show the button next to the existing actions; stacked full width on a phone via the page's ActionRow.
- [manual] Not exercised in a browser in this change.
- [cmd] README wording checked against `receivables.controller.ts` (cash needs a shift when the actor holds `sales.create`).
- [test] `stock-expiry.e2e-spec.ts`: create/edit with a past date 422; approving a draft whose date elapsed succeeds and the
  batch carries the date; stock-in and `POST /stock/opening` keep the check (existing tests).
- [cmd] Revert-red once for the approval change.

## Files

- pos-web: `routes/laporan/-csv.ts`, `-csv-download.ts`, `-csv-button.tsx`, `-csv.test.ts`, `csv.$jenis.ts`,
  `untung-rugi.tsx`, `routes/pengeluaran/index.tsx`.
- README.md.
- pos-api: `stock/stock.service.ts` (`receive` takes `savedExpiry`), `purchasing/purchasing.service.ts`,
  `test/stock-expiry.e2e-spec.ts`.
