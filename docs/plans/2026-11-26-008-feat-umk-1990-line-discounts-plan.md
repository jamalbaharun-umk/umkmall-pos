# UMK-1990: per-line discounts ("Diskon baris", design feature 30)

Epic UMK-1924. Design: Fase 2 page, section `diskon-baris` (approved by the owner). Replaces the cashier screen's
order discount (feature 8); pos-api keeps accepting the order `discount` field for older clients.

## Goal

Someone holding `sales.price_override` gives a discount on one cart line, as a percent or in rupiah. The server
computes it, the totals follow one fixed order, and the receipt, reports, profit, void and refund stay exact.

## Rules (from the design, with the decisions taken here)

- Order: line discount → (legacy order discount) → voucher on the amount after discounts → tax on the amount after
  every discount → cash rounding (cash only, up to the next Rp100, outside `total`; kasbon not rounded).
- Input per line: `discountPercent` (whole percent 1–99) or `discountAmount` (whole rupiah ≥ 1), not both.
- Percent → rupiah: `round half up (lineTotal × percent / 100)`, on the line's total (never per unit), so the
  line amounts always add up to the sale's line discount exactly.
- 100% is refused: a discount must leave at least Rp1 on the line (422 `DISCOUNT_INVALID`).
- A manual price and a discount on the same line are refused (422 `DISCOUNT_INVALID`): the design says the manual
  price replaces the discount, so the screen drops the discount when a price is typed.
- No `sales.price_override` → a line discount is 403 (a client price stays silently ignored, as before).
- Above 30% of the line (percent > 30, or amount × 100 > lineTotal × 30) needs an approval: an owner or staff member
  holding `sales.price_override` types their own 6-digit PIN (`POST /sales/discount-approvals`, the void PIN and its
  lockout). The approval is a row: actor, approver, product, the largest share approved (`maxBps`), 30 minutes,
  single use, taken inside the sale's transaction (`update … where used_at is null`). No PIN ever stays in the
  browser and none reaches the request hash.
- Wholesale (UMK-1985): the tier is chosen by the product's base units across lines as before, the discount applies
  on top of the tier price (line total = tier price × qty), the tier stays recorded ("Harga grosir"), and the 30% is
  measured on that line total.
- Stored: `sale_lines.discount`, `discount_percent`, `discount_approved_by`; `sales.line_discount`. `sales.discount`
  is every manual discount (line + order), so revenue = grossSales − discount − voucher + tax holds everywhere and a
  void reverses it with the stored figures.
- Reports: a line's sales and gross profit are net of its line discount (sales report row `discount`, product report
  `sales`); gross profit excludes tax.

## Definition of Done

- [test] e2e exact numbers: percent and amount, percent rounding half up, discount ≥ line refused, both kinds refused,
  manual price + discount refused, the design example (subtotal 50.000, line −2.000, voucher −3.000, PPN 11% 4.950,
  rounding 50, cash 50.000), wholesale + discount, kasbon not rounded, client total and price ignored, 403 without the
  permission, idempotent replay, void and refund restore stock and reverse exact amounts, reports and profit.
- [test] approvals: >30% without approval 422, wrong PIN 422, approver without the permission refused, approval used
  once, expired, for another product, smaller than the discount; cross-tenant (store B cannot use store A's approval
  or approver).
- [test] pos-web vitest for the cashier's discount helpers.
- [test] revert-red: tax before the discount, and the permission check.
- [cmd] `npm run lint && npm run typecheck && npm run build`, pos-web `npx vitest run`, pos-api suites.
- [qa] Playwright at 375 and 1024: give a 10% and a 40% (PIN) discount, pay cash, read the receipt.

## Files

- `apps/pos-api/src/sales/` (schemas, service, controller, `line-discount.ts` + spec), `src/void/void-pin.ts` (the
  approver's permission becomes a parameter), `src/db/schema/sales.ts`, one migration, `src/reports/reports.service.ts`.
- `apps/pos-web/src/routes/kasir/` (`-discount.ts` + test, `-discount-dialog.tsx`, `index.tsx`, `-api.ts`,
  `struk.$id.tsx`, `riwayat.$id.tsx`).
- Tests: `apps/pos-api/test/line-discounts.e2e-spec.ts`.
