# UMK-2117: report PDFs are tidy (columns, baselines, chart labels)

Epic UMK-1924. Follow-up of plans 2026-11-27-002 (server PDF) and 2026-11-27-004 (font coverage).

## Goal

The owner opened a real sales report PDF: text spills out of its column. In the "Rincian" table a SKU such as
`SEM-TEH-0001` wraps at its hyphens onto two or three lines that overlap the next rows (fixed row height, and pdfkit
still wraps a `lineBreak: false` cell that has a `width`); the payment-mix bar, the charts and the legend use a fixed
560 pt instead of the page's content width; the summary grid leaves a hole when the card count is odd. QA (UMK-2117)
found that chart labels drawn by svg-to-pdfkit lose Arabic shaping (`قهوة عربية` → `عربه قهوه`) and Thai marks
(`เย็น` → `เยน`), and that in the table an Arabic name sits low and a Devanagari name high (each Noto face has its own
ascent, and pdfkit places text by its top). Every report PDF kind (sales, products, shifts, purchasing, profit-loss,
receivables, sales-and-expenses) must be tidy: nothing leaves its column, nothing overlaps, money is never cut.

## Design (intent)

- **One table rule: one line per cell, truncate with an ellipsis.** Column widths come from the content: each
  column states its kind (`text` names that take the remaining width; `nowrap` codes and dates sized to their widest
  value up to a cap; `money`/`int` sized to their widest value, never truncated). A pure helper computes the widths
  from the page width with per-column minimums; if the numbers alone do not fit, the table's font size steps down.
  Text is truncated by measuring with the real faces (`PdfFonts`, mixed-script safe) and drawn without a pdfkit
  width, so pdfkit never wraps it. Header and body share the same widths and alignment; money is right-aligned; the
  header repeats on every page; a row is never split; a table title stays with its header and first rows.
- **One baseline per row.** Every run of a line is drawn at a common alphabetic baseline computed from the primary
  face (pdfkit `baseline: 'alphabetic'`), so Arabic, Thai, Devanagari and Chinese sit on the row like Latin.
- **Chart labels that need another face are drawn by pdfkit over the SVG**, with the same shaping path as the
  table; Latin labels stay in the SVG byte for byte.
- **Charts, the payment-mix bar and its legend span the content width**; legend amounts and percentages are
  right-aligned to the end of the bar, sized to their content.
- **Summary cards:** the last row's cards share the full width (no hole); a value is never cut (its size steps down
  if needed), a label is truncated with an ellipsis.

## Definition of Done

- [test] Unit: the width helper gives money/int columns at least their widest value, codes their value up to the
  cap, names the remaining width, never exceeds the page width, and steps the font down when the numbers do not fit.
- [test] Unit: a string wider than its column is truncated with an ellipsis and measures within the width (Latin and
  mixed-script); an amount is never truncated.
- [test] Unit: a chart's non-Latin labels are taken out of the SVG and returned for pdfkit; Latin labels stay.
- [test] e2e: for each PDF kind (sales, products, shifts, purchasing, profit-loss, receivables, sales-and-expenses)
  the PDF text carries the full amounts and the full short names of a store with long names, long SKUs, large and
  negative amounts.
- [test] Revert-red once: the truncation guard fails with the old fixed-weight/no-truncation path, then restored.
- [test] The existing pdf and report-pdf tests stay green (expectations changed only where the layout changed).
- [cmd] `npx tsc --noEmit`; `PGTEST_DB=pos_f45 npx jest --runInBand src/reports test/report-pdf test/guards
  src/guards test/db.e2e-spec.ts`; the whole pos-api suite once.
- [qa] Every kind rendered from a demo store (60+ character names, long SKUs, Rp123.456.789, negative amounts,
  3+ pages, Arabic, Thai, Devanagari, Chinese, Cyrillic names), rasterised with `pdftoppm -r 90` and looked at.
- [manual] The owner opens a new sales report PDF.

## Files

`apps/pos-api/src/reports/pdf/pdf-document.ts`, `pdf-fonts.ts`, new `table-layout.ts` and its spec,
`fonts.spec.ts`, `pdf.spec.ts`, `apps/pos-api/src/reports/export/report-defs.ts`, `report-pdf.service.ts`,
`apps/pos-api/test/report-pdf.e2e-spec.ts`.
