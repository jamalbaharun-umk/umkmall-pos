# Lakasir local E2E — findings (2026-11-17)

Reference run for the UMKMall POS port (UMK-1924).
Instance: a local Docker run of upstream Lakasir (single-tenant first, then multi-tenant with two stores). Test logins stayed on that machine and are not in this repo.

## Setup notes
- Upstream Dockerfile uses PHP 8.2 but composer requires ^8.4 → bumped locally to 8.4.
- Config passed via docker-compose.override.yml (no .env file).
- Single-tenant mode = APP_CENTRAL_DOMAIN unset. Multi-tenant = APP_CENTRAL_DOMAIN set; tenants are
  resolved by SUBDOMAIN (`<id>.<central>`), one MySQL database per tenant (`lakasir_<id>`), signup ~3 s
  each (migrate + seed per tenant). Needs a DB user allowed to CREATE DATABASE.

## Exercised and working
- Web login, dashboard, create category, create product (auto SKU), classic cashier
  (`/member/cashier`): cart → cash payment with quick-amount buttons → change shown → stock decremented.
- API (Sanctum bearer): login, product list/create (multipart), payment methods, cash drawer open/close,
  normal sale, oversell rejected, credit sale → receivable row, voucher + item discount + tax sale,
  dashboard metrics, cashier report PDF.
- Multi-tenant: two stores registered via API; each gets its own DB; store B cannot list or fetch store
  A's products; A's token is refused on B's host; tenant web login page serves.

## Verified bugs / design flaws (fix by design in our version)
1. Voucher quota is decremented BEFORE validation (request prepare step). A quota-1 voucher can never be
   used ("voucher expired"), and every attempt — including failed ones — burns quota.
2. Tax is computed on the subtotal BEFORE discounts (item discount and voucher are subtracted after tax),
   so customers pay tax on the discounted amount.
3. Price override ("friend price") trusts the client: a cashier token sold 5 items for Rp1, accepted;
   `total_cost` saved NULL → profit reports break. No permission gate.
4. Sales are never linked to a cash drawer/shift (`cash_drawer_id` always NULL, nothing sets it). Drawer
   enforcement is an optional setting and only on the API path; the web cashier never checks it.
   → shift reconciliation impossible.
5. Dashboard API: the field named revenue returns price − cost (profit), and gross profit returns gross
   sales — swapped. Required `timezone` query param is unvalidated → 500 instead of 422. Cashier report
   missing `start_date` → 500.
6. New POS UI (`/member/p-o-s`, feature flag PosV2) is unfinished: cart subtotal multiplies qty twice
   (3 × 5,000 shows 45,000), 10% tax hardcoded in the view, "Continue Payment" only logs to console.
7. Credit sale via API 500s unless the client sends a per-item `price` (receivable item derives unit price
   from it).
8. Stock and voucher updates have no row locks / atomic decrements → race under concurrent cashiers.
9. Auto SKU contains a space (`MIN-ES -0001`). API names "price after discount" `discount_price` (confusing).
10. Money stored as floats/decimals mixed; no idempotency key on sale creation.

## Retracted (were artifacts of my test harness, not Lakasir bugs)
- "Login response is invalid JSON" — zsh `echo` collapsed `\\`; JSON is valid.
- "Timezone not saved until Save" — profile already had Asia/Jakarta.

## Read from code, NOT exercised end to end
Supplier → purchasing (stock in; FIFO vs "normal" batch selection), stock opname, receivable payment,
member UI, voucher UI, tables (F&B), receipt printing (browser printer / A5), web report pages,
roles & permissions UI, product import/barcode label printing, PosV2 beyond the cart.

## Feature inventory (for the spec)
Back-office resources: category, product (images, barcodes, SKU, unit, initial/selling price, type:
product/service/non-stock, price units), supplier, purchasing (+approval, payment method), stock
batches, stock opname, member, payment method (cash/debit/credit/wallet), receivable (+payments),
voucher (percentage/flat, min buying, quota, date range), table, user, role, permission.
Pages: dashboard, cashier, POS v2, cart, cashier/selling/product/purchasing reports, general setting
(about, app, feature toggles, profile/timezone/language), printer, update.
API: ~60 routes — auth, master data (category, member, product + stock, supplier, payment method),
transaction (selling, cash drawer, dashboard), reports (cashier PDF), settings, printer, notifications,
tenant signup (`domain/register`).
