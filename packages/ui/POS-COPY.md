# @umkmall/ui (POS copy)

A snapshot of UMKMall's design system, copied from the UMKMall monorepo `packages/ui` at commit
`2f46a4230` (2026-11-17) because the package is not published yet (owner decision, UMK-1924). Publishing it to
GitHub Packages is the follow-up; when it lands, this folder is deleted and `@umkmall/ui` comes from the registry.

Differences from the monorepo original, all deliberate:
- `tsconfig.json` is standalone (the original extends the monorepo root); `tsconfig.pos.json` typechecks the web
  surface only (excludes `src/native` and tests).
- `package.json` scripts: `typecheck`, and `test`, which runs only the chart tests (below) and the two token guards
  (`no-raw-colour`, `no-px-font-size`). The rest of the package's tests guard monorepo consumers (`apps/mobile`, …)
  and stay in the monorepo; many of them cannot pass in this copy.

## Local addition: charts (owner exception 2026-11-26, UMK-2074)

Charts are the ONE thing built here rather than copied. The owner allowed it so the POS reports and the server PDF
share one chart standard (UI guideline "Panduan Dasar UI POS", section 7). No existing file was changed except the
one-line export in `src/primitives/index.ts` and the `test` script above. **A later re-vendor keeps these files**:

- `src/primitives/Charts/` (everything in it): `BarChart`, `LineChart`, `AreaChart`, `DonutChart`, `SegmentedBar`,
  `Sparkline`, `StatTile`, `MarginTile`, `HeatStrip`, `Meter`, `MeterList`, `ChartFrame`, the rupiah/number
  formatters (`formatRupiah`, `formatRupiahShort`, …), the scale maths, `theme.tsx` (the `--ds-chart-*` tokens, light
  and dark) and their tests (`charts.*.test.ts(x)`).
- the line `export * from './Charts';` at the end of `src/primitives/index.ts`;
- the `test` script in `package.json`.

They are pure SVG (no charting dependency), render with `react-dom/server`, and read colour only from tokens. When
the package is published, move this folder to the monorepo first.

Do not edit any other component here. A needed change goes to the monorepo first, then this copy is refreshed from it.

## Known upstream issues

- **`Select` with `portal` + `showSearch` never opens on a real pointer click** (seen 2026-11-17, UMK-1924 QA): the
  document-level outside-press handler closes the portalled list in the same pointer sequence that opened it; a
  scripted `button.click()` still opens it, so automated tests miss it (Select.tsx warns about portalled lists
  near its outside-press handling). POS workaround: never pass `portal` together with `showSearch` (`portal` alone opens fine and is used by the dialog
  form Selects in `routes/pelanggan/-ui.tsx`; the purchase and stock-opname line pickers
  render in place inside a table whose container is `overflow-visible`; guarded by
  `apps/pos-web/src/routes/pembelian/-no-portal.test.ts`). Fix belongs in the monorepo's `packages/ui`, then this
  copy is refreshed.
