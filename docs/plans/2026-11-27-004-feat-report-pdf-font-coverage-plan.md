# UMK-2074: report PDFs render names in any script

Epic UMK-1924. Follow-up of the server-side report PDF (plan 2026-11-27-002).

## Goal

The report PDF registers only the Latin subset of Be Vietnam Pro, so a product, customer or staff name in Arabic
(Jawi), Chinese, Japanese, Korean, Thai, Devanagari, Cyrillic, Greek or a Latin-extended alphabet prints blank or as
boxes. Any name a store owner might enter must render. Latin text keeps today's output exactly.

## Design

- `src/reports/pdf/fonts.ts` (pure, no pdfkit): `splitRuns(text)` NFC-normalises a string and cuts it into runs by
  face. The primary face (Be Vietnam Pro latin, ranges read from the package's `unicode.json`) owns everything it
  covers, including digits, spaces and punctuation, so Latin text is one run and takes today's code path. Other
  characters go to the first fallback face whose unicode range holds them: Noto Sans (Cyrillic, Greek, Latin
  extended, Vietnamese subsets), Noto Sans Arabic, Thai, Devanagari, and Noto Sans SC (numbered slices: Han, kana,
  Hangul). Combining marks and joiners stay with the face of the character before them when it covers them.
- `src/reports/pdf/pdf-fonts.ts`: registers a face with pdfkit on first use, per weight (400/600/700 as Body, Semi,
  Bold); draws, measures and truncates a string that spans several faces; rewrites chart `<text>` into per-run
  `<tspan font-family>` for svg-to-pdfkit and maps the family back in its `fontCallback`.
- Fail safe: a face whose file is missing or unreadable falls back to the primary face (blank glyph, never a failed
  PDF); one warning per face, never the text.
- Right to left: each run is shaped by fontkit; a string whose first strong run is Arabic is drawn with its runs in
  reverse order. Limitation documented in the code and the report.

## Definition of Done

- [test] `splitRuns` unit tests: Latin, Latin-extended (`Café Ñandú`), Cyrillic, Greek, Arabic, Thai, Devanagari,
  Chinese, kana, Hangul, mixed `Toko 北京 Jaya`, digits and punctuation with the surrounding Latin run, combining
  marks, a missing font file falling back.
- [test] A real report PDF with product names in Latin-extended, Cyrillic, Arabic and Chinese carries those glyphs
  in its text extraction and the fallback faces' names.
- [test] Revert-red: a chooser that returns the primary face only fails the new tests; restored.
- [test] The existing pdf and report tests stay green (Latin output unchanged).
- [cmd] `npx tsc --noEmit` and the lint of the touched files; `PGTEST_DB=pos_f43 npx jest --runInBand src/reports
  test/report-pdf test/guards src/guards test/db.e2e-spec.ts`; the whole pos-api suite once.
- [qa] A sample PDF with mixed-script names rasterised and looked at.
- [manual] none; the Dockerfile needs no change if the fonts are plain `node_modules` files (checked, see report).

## Files

`apps/pos-api/src/reports/pdf/fonts.ts`, `pdf-fonts.ts`, `fonts.spec.ts`, `pdf-document.ts` (draw calls),
`apps/pos-api/test/report-pdf.e2e-spec.ts`, `apps/pos-api/package.json`, `package-lock.json`.
