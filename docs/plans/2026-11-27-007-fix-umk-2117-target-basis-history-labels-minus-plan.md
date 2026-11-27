# fix(umk-2117): daily target basis, history card labels, minus signs, QA script, button widths

Epic UMK-1924, QA follow-up UMK-2117. Five small fixes found in QA.

## Goal

The daily target, the dashboard and the reports speak about "sales" the same way (tax left out); the Riwayat penjualan
cards say what they count; every negative rupiah prints through one formatter with a real minus and never "-Rp0"; the
M2 QA script matches the Susut stok rule; the two save buttons on Pengaturan > Aplikasi look alike on a phone.

## Definition of Done

1. Target basis
   - [test] `test/summaries.e2e-spec.ts`: a taxed sale then a void; the target's `today` and percent equal the
     dashboard widget's `current.sales` (tax out, void taken off). Revert-red once (old `dayTotals` basis fails it).
   - [test] The cashier without `reports.view` still gets the percent only (existing test stays green).
2. History cards
   - [qa] `/kasir/riwayat`: "Total hari ini (jumlah dibayar pelanggan)" and "Cara bayar hari ini (jumlah dibayar
     pelanggan)". The dashboard card keeps its title "Cara bayar hari ini" (its description already says "tanpa
     pajak"). The API's history figures do not change.
3. Minus signs
   - [test] `rupiah.test.ts`: 0, -0, -0.4, negated amounts, never a hyphen.
   - [cmd] No `−{rupiah(` / hyphen-built negative rupiah left in `apps/pos-web/src`.
4. QA script
   - [cmd] `node --check scripts/qa/m2-api-mcp-run.mjs`; arithmetic: gross 71.750 - Susut stok 2.000 - expenses
     10.000 = 59.750 (the script needs a running stack, not run here).
5. Buttons
   - [qa] 375 px, Pengaturan > Aplikasi: both "Simpan" buttons in an `ActionRow`, full width on a phone, natural width
     from `sm`.
   - [cmd] `npx tsc --noEmit` in both apps, `npx vitest run` in pos-web, the pos-api jest set.

## Files

- `apps/pos-api/src/summaries/summaries.service.ts` (`netSalesToday`, used by `dailyTarget`; `dayTotals` unchanged
  for the history cards, which show the amount paid).
- `apps/pos-api/test/summaries.e2e-spec.ts`
- `apps/pos-web/src/routes/ringkasan/-panels.tsx`
- `apps/pos-web/src/lib/rupiah.ts` and test; kasir `index.tsx`, `-discount-dialog.tsx`, `-u7.tsx`, `riwayat.$id.tsx`,
  laporan `kasbon.$memberId.tsx`, `pengeluaran/index.tsx`, `kas-toko/-deposit-helpers.ts` and test.
- `apps/pos-web/src/routes/pengaturan/index.tsx`
- `scripts/qa/m2-api-mcp-run.mjs`, `docs/qa/2026-11-26-m2-api-mcp-run.md`.
