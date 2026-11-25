# UMK-1985: price units and wholesale (tiered) pricing (server part)

Epic UMK-1924, unit U2 (catalog), touching U3 (sales). Design approved by the owner on 2026-11-24 (tab 3
"Harga grosir & satuan" of the P0 design). This plan covers pos-api only; the product form, the unit picker
and the cart badge are a separate change.

## Goal
A product is sold in its base unit (pcs) and, optionally, in other units (dus = 24 pcs) with a fixed price
per unit, and the base unit price drops when the quantity reaches a wholesale tier. The cashier never
computes a price: the server picks the unit price and the tier.

## Rulings used (owner, final)
- A product has one **base unit** (`products.unit`, price `sellingPrice`) and 0..10 **other units**, each
  `{ name, unitQty, price }`: `unitQty` base units per unit (integer ≥ 2), a fixed price per unit.
- **Wholesale tiers** are per base unit: `{ minQty, price }`, 0..10 per product.
- **The tier is chosen by the TOTAL quantity of the product in the cart in base units** (1 dus = 24 pcs),
  across all its lines. It prices the **base-unit lines only**; a line in another unit always costs its fixed
  unit price. 1 dus + 6 pcs = 30 pcs: 6 × 3.300 + 78.000 = 97.800.
- The same product may be on several lines, one per unit (pcs and dus). The same product AND unit twice is
  still refused (422): the client adds the quantities.
- Nothing is converted automatically: 24 loose pcs (79.200) and 1 dus (78.000) are both sold as entered.
- **Stock is kept in base units.** 1 dus draws 24. The FIFO cost of the base units drawn is stored on the
  line, as today. A void (and a cancelled unpaid sale) puts back exactly the movements the sale drew, so it
  restores base quantities with no change to the void code.
- A client price counts only with `sales.price_override` (unchanged); the override replaces the price of
  that line's unit. Owner ruling 2026-11-25: an overridden line is a manual price, not wholesale
  (`appliedTier` null, `savings` 0, `manualPrice` true; `normalUnitPrice` and `listPrice` stay the
  server's); its base quantity still counts toward the product's total. Tax after discounts and cash
  rounding are unchanged.
- **Validation at product save (422):** tier `minQty` integer ≥ 2 and strictly increasing; tier prices
  strictly decreasing and never above the base price; unit `unitQty` integer 2..10.000; unit price integer
  > 0; unit names unique per product ignoring case, and different from the base unit name. The rules are
  checked against the stored product on a partial update (lowering `sellingPrice` below a stored tier is
  refused on `sellingPrice`).
- **Warning, not error** (owner ruling 2026-11-25, replacing "the cheapest tier"): a unit whose price is
  above `unitQty × the price per base unit of the tier that unitQty itself reaches` (the tier for a total of
  `unitQty` base units; the base price when it reaches none). Create and update answer `warnings: [{ code,
  field, message }]` (empty when none). The design example does not warn: 24 pcs reach the 12+ tier,
  24 × 3.300 = 79.200 ≥ 78.000. That two dus cost more than 48 loose pcs (QA gap G-13) is accepted.
- Purchases, stock opname and opening stock stay in base units.

## Schema (migration `0026_units_wholesale`)
- `pos.product_units`: `tenant_id` FK → `pos.tenants`, RLS, `product_id` FK (cascade), `name`, `unit_qty`
  (check ≥ 2), `price` (check > 0); unique `(product_id, lower(name))`.
- `pos.product_price_tiers`: `tenant_id` FK, RLS, `product_id` FK (cascade), `min_qty` (check ≥ 2), `price`
  (check > 0); unique `(product_id, min_qty)`.
- `pos.sale_lines` gains `unit` (name snapshot; null on rows from before this change = the product's base
  unit), `unit_qty` (default 1), `base_qty` (generated: `qty × unit_qty`, so it can never disagree),
  `normal_unit_price` (price of the unit before any tier; null on old rows = `list_price`) and
  `applied_tier_min_qty` (null = no tier). `qty` stays the quantity in the line's unit, so
  `line_total = unit_price × qty` holds; `list_price` is the server's price for the unit (tier price for a
  tiered line), `unit_price` what was charged.
- A sale line snapshots the unit name, multiplier and prices: editing or removing a unit or tier never
  changes a past sale (QA UNT-012, UNT-013). Old rows need no backfill.
- The purge discovers both new tables by `tenant_id`; its seed gets a unit and a tier.

## API
- `POST /catalog/products`, `PATCH /catalog/products/:id` accept `units` and `priceTiers` (each replaces the
  stored list when sent) and answer the product plus `warnings`. `GET /catalog/products` and `/:id` carry
  `units` (`{ id, name, unitQty, price }`, smallest pack first) and `priceTiers` (`{ minQty, price }`).
- `POST /sales` lines take an optional `unit` (name, case-insensitive; omitted or the base unit name = base
  unit). An unknown unit answers 422 on `lines.<i>.unit`.
- `GET /sales/:id` (and the answer of `POST /sales`) lines add `unit`, `unitQty`, `baseQty`,
  `normalUnitPrice`, `appliedTier` (`{ minQty, price } | null`) and `savings`
  (`(normalUnitPrice − listPrice) × qty`, the tier's saving; 0 without a tier). The receipt lines add `unit`,
  `unitQty`, `baseQty`, `normalUnitPrice`, `appliedTier`, `savings`.
- `POST /sales/quote` (`sales.create`): `{ lines }` → the same line pricing with nothing written, plus
  `nextTier` (`{ minQty, price, remaining } | null`, `remaining` in base units) on every line of the
  product, and `subtotal`. This is what the cart uses for the "Harga grosir" badge and the hint "Tambah N pcs
  lagi untuk harga …". `nextTier` is a cart hint, so it is on the quote and not stored on a sale.
- Reports: the product report counts base units (`base_qty`); the sales report rows keep the line's own
  quantity and add `unit` (JSON only; the CSV columns are unchanged), and its quantity total stays the sum
  as rung up.

## Definition of Done
- [test] Product with a dus (24, Rp78.000) and tiers 12 → 3.300, 48 → 3.200 is saved and read back (create,
  get, list); update replaces units and tiers; delete of a unit leaves a past sale intact.
- [test] Validation 422 with a field: pack size 0, 1, negative, decimal; duplicate unit name (any case);
  unit named like the base unit; tiers with the same or descending `minQty`; tier price not decreasing;
  tier price above the base price; lowering `sellingPrice` below a stored tier.
- [test] `warnings` on create and update when a unit price is above pack × the price of the tier the pack
  reaches; none otherwise (none for the design example).
- [test] Tier boundaries: 11 pcs → 3.500, 12 → 3.300, 47 → 3.300, 48 → 3.200 (pure pricing spec and e2e).
- [test] Owner example: 1 dus + 6 pcs → 19.800 + 78.000 = 97.800; 6 pcs alone → 21.000; 11 pcs + 1 dus →
  114.300; a dus line is never tiered (2 dus = 156.000).
- [test] Design cart 12 pcs + 1 dus at 11% tax: subtotal 117.600, tax 12.936, total 130.536, cash rounding
  64, amount due 130.600; with a Rp10.000 discount: tax 11.836, total 119.436.
- [test] Stock in base units: 1 dus draws 24; FIFO cost across two batches is stored per line; 1 dus with
  23 in stock is refused; 12 pcs + 1 dus with 35 in stock is refused naming the remaining 35, nothing drawn.
- [test] Void of a pcs + dus sale puts back 36 base units.
- [test] Client price ignored without `sales.price_override` on a tiered line and on a dus line; honoured
  with it, cost unchanged.
- [test] Idempotent retry of a two-line same-product cart returns the first sale, stock moved once.
- [test] Cross-tenant: store B gets 404 on store A's product (read, update with units, delete), cannot sell
  it, and never sees A's units or tiers in its list.
- [test] Guards: `test/db.e2e-spec.ts` (RLS) and `test/purge.e2e-spec.ts` (seed reaches every table) cover
  the two new tables.
- [test] Revert-red, once each: tier by total base quantity (count only the line's own quantity → the owner
  example fails); stock draw in base units (draw `qty` → the dus stock test fails).
- [cmd] `npm run lint && npm run typecheck && npm run build`; `PGTEST_DB=pos_u1985 npx jest --runInBand`.
- [qa] Product form (units, tiers, warning), unit picker sheet, cart badge and hint: not done here (UI).

## Files
- `apps/pos-api/src/db/schema/catalog.ts` (two tables), `sales.ts` (line columns), `drizzle/0026_*`.
- `apps/pos-api/src/catalog/pricing.ts` (new, pure: validation rules, warnings, tier choice, line pricing),
  `catalog.schemas.ts`, `catalog.service.ts`.
- `apps/pos-api/src/sales/sales.schemas.ts`, `sales.service.ts`, `sales.controller.ts`.
- `apps/pos-api/src/reports/reports.service.ts` (base quantity in the product report).

## Tests to add
- `apps/pos-api/src/catalog/pricing.spec.ts`: rules, warning, tier boundaries, multi-line pricing.
- `apps/pos-api/test/units-wholesale.e2e-spec.ts`: everything under Definition of Done.
- `apps/pos-api/test/purge.e2e-spec.ts`: seed a unit and a tier. `test/sales.e2e-spec.ts` unchanged.

## Follow-ups (not in this change)
- UI (product form, unit picker, cart badge and hint): its own change, uses `POST /sales/quote`.
- Purchase by unit (receive 5 dus instead of 120 pcs): purchases stay in base units for now.
- A barcode per unit (scan a carton → the dus line): barcodes still name the product only (QA UNT-022).
- Kasbon detail (`GET /receivables/:id`) lines do not show the unit yet.
- A sale line is capped at 100.000 units, as before (QA UNT-023 asks for 1.000.000 pcs).
- Per-line discounts (the next issue) will change the same pricing function.
