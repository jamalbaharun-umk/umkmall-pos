# Design features 37 and 38: report charts and a server-side PDF (UMK-2074 charts)

Epic UMK-1924. Owner request 2026-11-26. Design pages `lap-diagram` (feature 37, "Laporan dengan diagram batang dan
ekspor PDF") and `viz-laporan` (feature 38, "Visualisasi untuk laporan dan ringkasan"); UI guideline "Panduan Dasar
UI POS" section 7 (charts), 2 (toast and error dialog) and 6 (buttons). Linear has no issue titled for features 37 or
38; the chart components are UMK-2074 and the sibling feature 39 is UMK-2075, so commits reference UMK-2074.

## Goal

Every report shows its data as charts beside the figures and the table, and can be downloaded as a PDF made on the
server, in a proper report format, drawing the same chart components as the screen. A new screen "Penjualan dan
pengeluaran" compares sales and expenses per day, month or year.

## Owner rules used

- Every report and summary visualises its data (bars, day/month/year comparison), colours from the primary palette
  through `@umkmall/ui` `primitives/Charts` (UMK-2074). `packages/ui` is never edited here; no chart was missing.
- The PDF is generated on the server (pos-api), never in the browser, and renders the same chart components with an
  explicit width and height (they are SSR safe), so the file matches the screen. The file is never stored.
- Money is integer rupiah; the server computes every figure; tax is shown apart and is not income (decision 25 Nov);
  a void is a reversal on the day it was done; days, months and years follow the store's timezone.
- The PDF route has the report's own permission (`reports.view`), the tenant comes from the session, and the PDF holds
  no customer phone number.

## PDF engine: pdfkit (pure Node) with the charts' SVG converted, not headless Chromium

Decision. Considered, with the reasons:

| | headless Chromium (playwright) | pdfkit + svg-to-pdfkit (chosen) |
| --- | --- | --- |
| Production image | needs `chromium` and its fonts and libraries installed in `node:22-bookworm-slim` (hundreds of MB), a sandbox that does not run as `node` without `--no-sandbox`, and `/opt/pw-browsers` exists only on this machine, not in Railway | two npm packages and one font package; runs in the image as is |
| Cost per document | a browser process per request (about 150 MB, 1 s cold start); concurrency is a pool to size and keep alive | about 100 ms and a few MB, in process; limited by a counter |
| Fidelity to the screen | exact (it renders the page) | the charts are the same component rendered to SVG, then drawn as vector; layout of the page, tables, header and footer is ours |
| Failure modes | browser crash, zombie processes, OOM | none beyond a JS exception |

Chromium would only be acceptable if it could be a production dependency; it cannot without changing the platform.
So: pdfkit 0.17 (fontkit 2, CommonJS; 0.21 needs an ESM-only fontkit that Jest cannot load), svg-to-pdfkit, and
`@fontsource/be-vietnam-pro` (the UI's font, OFL, woff 400/600/700, has the real minus sign U+2212).

How the same components reach the server. `apps/pos-api/charts/entry.js` imports `BarChart` and `SegmentedBar` from
`packages/ui/src/primitives/Charts` and renders them with `react-dom/server`. `scripts/bundle-charts.mjs` (esbuild)
bundles that, React included, into `apps/pos-api/generated/charts.cjs` (git-ignored) and writes the design tokens of
`packages/ui/tokens.css` into `generated/chart-tokens.json`. It runs before `nest build`, in the Jest global setup and
in the Dockerfile, so the runtime has no React dependency and tsc never compiles the UI package. The charts style
themselves with CSS classes and `rgb(var(--ds-chart-1))`; `pdf/svg-inline.ts` turns that into plain attributes with
the colours the tokens resolve to (light theme) and throws on an unknown token rather than draw a wrong colour.

## What it is

- `GET /reports/sales-expenses?scale=day|month|year&to=&count=`: buckets (sales without tax, expenses without
  supplier payments), window totals (sales, cost, gross profit, expenses, net profit, tax: the profit and loss
  report's numbers, from the same two service calls), the change from the window before, and the chart as data.
  Defaults 7 days, 6 months, 3 years; at most 92 days, 36 months, 10 years (422 `EXPORT_RANGE_TOO_LARGE`).
- `GET /reports/visuals/{sales,products,shifts,purchasing,profit-loss,receivables}`: the charts of each report as
  data (`BarsVisual`, `SegmentsVisual`, `reports/visuals/types.ts`). The screen and the PDF both draw these.
- `GET /reports/pdf/{sales,products,shifts,purchasing,profit-loss,receivables}` and
  `GET /reports/sales-expenses/pdf?include=summary,chart,table`: A4 PDF (landscape for the two wide tables), header
  with store name and address, report title and period, summary, charts, table (at most 400 rows, then a note; the
  figures cover every row), footer "Dicetak 26 Nov 2026, 14.05 oleh Rina · UMKMall POS, Halaman x dari y".
- Limits: 3 documents at once per instance (503 `EXPORT_BUSY`), 20 s (503 `EXPORT_TIMEOUT`), 60 pages or 8 MB
  (422 `EXPORT_TOO_LARGE`), `Cache-Control: no-store`.
- pos-web: `components/report-visual.tsx` draws a visual; each report screen gets its charts and an "Unduh PDF" button
  (one line, 44 px, `ActionRow` stacks it on a phone, success toast, error dialog); new route
  `/laporan/penjualan-pengeluaran` with the scale, period arrows, metric choice, chart, table and the PDF dialog.
- No migration, no new table: the purge is unchanged.

## Definition of Done

1. [test] `reports/export/scales.spec.ts`: buckets, labels, period wording, percent change, query validation.
2. [test] `test/report-pdf.e2e-spec.ts`: the trend endpoint equals the profit and loss figures; window limits 422;
   every PDF starts `%PDF-`, is under 2 MB, and its extracted text holds the store name and address, the period, the
   report's figures, the chart title and axis, "Dicetak ... oleh ...", "Halaman 1 dari 1"; `include` picks the parts;
   empty store still makes a valid PDF; 401 without a session, 403 without `reports.view`, 200 with it, on every
   route; store B gets its own name and numbers and none of store A's; a tenant id in the query is ignored; no phone.
3. [test] `reports/pdf/pdf.spec.ts`: slot limit, timeout, page cap, token resolution (primary palette hex values,
   unknown token throws), the SVG has no class, style or `var()` left.
4. [test] pos-web: helpers of the new screen and of the PDF download (error to dialog text), visual to chart props.
5. [revert-red] remove `@RequirePermission('reports.view')` from `ReportExportController`: the 403 test fails; restore.
6. [cmd] `npm run lint && npm run typecheck && npm test && npm run build` with `PGTEST_DB=pos_f38`.
7. [qa] browser at 375 and 1024 px on the new screen, a report screen and the PDF dialog; one generated PDF page opened
   as an image to check the layout.
8. [manual] not done here: owner approval of features 37 and 38 ("Setuju fitur 37/38"), a PDF in Acrobat and on a phone
   viewer, the production image build with the new Dockerfile lines.

## Files

pos-api: `charts/entry.js`, `scripts/bundle-charts.mjs`, `src/reports/export/*` (scales, trend service, visuals
service, report definitions, PDF service, controller and module), `src/reports/pdf/*` (builder, SVG inlining, chart
renderer, limits, formats), `src/reports/visuals/types.ts`; one-line additions: `app.module.ts`,
`ReportsModule` exports, `ExpensesModule` exports, `receivables-report.service.ts` (`aging`), `Dockerfile`, `.gitignore`,
Jest global setup. pos-web: `routes/laporan/*`, `components/report-visual.tsx`, `nav` untouched.

## Not in this change

Visuals for Stok, Pengeluaran list, Tutup shift and the dashboard cards (feature 39 and the dashboard session);
the Susut stok line; dark-mode PDF (a printed report is light).
