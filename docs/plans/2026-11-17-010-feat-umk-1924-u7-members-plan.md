# UMK-1924 U7: members, vouchers and credit sales

Epic unit U7 ([epic plan](2026-11-17-001-feat-pos-epic-plan.md)). Ported from Lakasir's `Member`, `Voucher`,
`Receivable`, `ReceivablePayment`, `PaymentMethod` models, `VoucherService`, `ReceivableService`,
`ReceivablePaymentService` and their Filament resources, with lakasir-findings.md flaws 1, 2 and 7 fixed by design.

## Goal

A store keeps its members, its payment methods (cash/debit/credit/wallet) and its vouchers. The cashier can attach a
member, apply a voucher code and choose a payment method. A credit ("kasbon") sale creates a receivable for the
member from the server's own totals; payments reduce it until it is settled. Voucher quota and receivable balance
change only inside locked transactions; money is integer rupiah.

## Design

### Payment methods (`src/payment-methods/`)

- `pos.payment_methods` (U3) gains `is_debit`, `is_credit`, `is_wallet`, `deleted_at`; a check makes exactly one
  of the four flags true (Lakasir allowed nonsense combinations). "Tunai" stays the seeded cash method and cannot
  be edited or deleted (422).
- `GET /payment-methods` (any session: the cashier picks one), `POST`, `PATCH /:id`, `DELETE /:id` (soft) under
  `catalog.manage` (the store-settings permission U3 uses for tax). A name already used answers 409.

### Members (`src/members/`)

- `pos.members`: tenant, `name`, `code` (unique per tenant among live rows), `phone`, `address`, soft delete.
  PII: never logged; the U8 purge must delete the table. Lakasir's email/identity fields are dropped (minimised).
- `GET /members?q=` (any session, name/code/phone search, first 50: the cashier's picker), `GET /:id`,
  `POST`, `PATCH`, `DELETE` (soft) under the new `members.manage`.

### Vouchers (`src/vouchers/`)

- `pos.vouchers`: tenant, `name`, `code` (unique per tenant among live rows), `type` `percentage|flat`, `nominal`
  (percent 1–100 or rupiah), `kuota` ≥ 0, `start_date`, `expired` (dates, inclusive, Asia/Jakarta),
  `minimal_buying` rupiah, soft delete.
- CRUD under the new `vouchers.manage`; `POST /vouchers/check {code, amount}` (`sales.create`) answers the discount
  the cashier would get, or 422 with the reason, without touching quota.
- In the sale (flaw 1): the voucher is read and validated first (exists, date range, quota > 0, minimum on the
  amount after the manual discount), its discount computed (percentage rounded half up, flat capped at the amount),
  then `update vouchers set kuota = kuota - 1 where id = … and kuota > 0` inside the sale transaction; zero rows →
  422. A sale that fails later (stock, paid, key race) rolls the decrement back.

### Sale additions (U3 `src/sales/`, small and tested)

- `SaleInput` gains `memberId?`, `voucherCode?`, `paymentMethodId?` (default Tunai).
- `pos.sales` gains `member_id`, `voucher_id` (composite tenant FKs), `voucher_discount`. The money check becomes
  `total = subtotal − discount − voucher_discount + tax`, `discount + voucher_discount ≤ subtotal`,
  `change = greatest(paid − total, 0)`, and `paid < total` only with a member.
- Tax = round((subtotal − discount − voucher_discount) × bps / 10 000): after every discount (flaw 2; U3 already
  taxes after its discount, the fixture asserts it with the voucher).
- Payment method rules: cash → paid ≥ total, change; debit/wallet → paid = total; credit → member required,
  0 ≤ paid < total, change 0, and a receivable is created in the same transaction (flaw 7: from the server's
  totals, never a client price).
- Shift close counts only cash in the drawer: cash sales' `paid − change` plus credit sales' down payment
  (U3 summed every sale's `total`, wrong once non-cash methods exist).
- Receipt shows the voucher discount, the member name and the remaining kasbon.

### Receivables (`src/receivables/`)

- `pos.receivables`: tenant, `sale_id` (unique), `member_id`, `total`, `rest` (0 ≤ rest ≤ total), `due_date`
  (default sale date + 14 days, like Lakasir), `last_payment_at`. Settled ⇔ `rest = 0` (no separate status flag
  to drift). The items are the sale's own `sale_lines` (Lakasir copied them into `receivable_items` and divided
  client prices: flaw 7); no copy.
- `pos.receivable_payments`: tenant, receivable, `amount` > 0, `payment_method_id` (never a credit method),
  `rest_before`, actor, `created_at`. A credit sale's down payment is recorded as a Tunai payment.
- `GET /receivables?status=open|settled&memberId=`, `GET /:id` (lines, payments), `POST /:id/payments
  {amount, paymentMethodId?}` under the new `receivables.manage`: locks the receivable row `for update`, amount ≤
  rest (else 422), rest decreases, settled at 0 (a further payment 422). Lakasir's payment edit/delete is not
  ported (append-only ledger).

### pos-web

- `/pelanggan` (members list, search, form), `/voucher` (list, form), `/metode-pembayaran` (list, form),
  `/piutang` (list with open/settled filter) and `/piutang/:id` (lines, payments, record payment), built from
  `@umkmall/ui` with the admin theme, layout per Lakasir's Filament screens, Indonesian, loading/empty/error
  states; one line each in the central nav config if it exists (else the dashboard links).
- Cashier: member picker, voucher field (calls `/vouchers/check`), payment method choice in the payment dialog —
  added as small pieces to the cashier screen once `ui-parity-b`'s rebuild is on `main`.

## Definition of Done

- [test] quota-1 voucher: first sale uses it, second gets 422; a sale that fails on stock leaves the quota at 1
  (revert-red once: move the decrement before validation / out of the transaction, test fails, restore).
- [test] expired, not yet started, unknown code and below-minimum vouchers answer 422; `/vouchers/check` does not
  consume quota.
- [test] fixture: 2 × Rp2.000, discount Rp500, voucher 10 %, tax 10 % → subtotal 4.000, voucher 350, tax 315,
  total 3.465.
- [test] credit sale without client prices → receivable total = sale total, rest = total − paid; paid 0 allowed;
  credit without member 422; slice check: Rp6.000 to "Bu Sari", pay Rp2.500 → rest Rp3.500; pay Rp3.500 →
  settled; a further payment / overpayment 422.
- [test] shift close: expected cash excludes debit sales and counts a kasbon's down payment only.
- [test] permission refusals (cashier without `members.manage`/`vouchers.manage`/`receivables.manage`/
  `catalog.manage` gets 403 on writes).
- [test] cross-tenant: store B gets 404 on store A's member, voucher, payment method and receivable ids (read,
  update, delete, payment) and cannot use A's member, voucher code or payment method in a sale.
- [test] new tables have RLS (existing `db.e2e-spec.ts`).
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build` green; CI green on `main`.
- [manual] pos-web screens and the cashier controls in the browser next to Lakasir's.

## Files

- `apps/pos-api/src/{members,vouchers,receivables,payment-methods}/` (one module file each, like `suppliers`).
- `apps/pos-api/src/db/schema/members.ts` (members, vouchers, receivables, payments); `sales.ts` columns; one
  line in `db/schema/index.ts` and per module in `app.module.ts`; one migration.
- `apps/pos-api/src/sales/` (schemas, service), `src/shifts/shifts.service.ts` (cash total),
  `src/staff/permissions.ts` (three keys).
- `apps/pos-api/test/members.e2e-spec.ts`.
- `apps/pos-web/src/routes/{pelanggan,voucher,metode-pembayaran,piutang}/`, cashier additions.

## Not in this unit

Receivable payments inside a shift's cash count (Lakasir has no link either), WhatsApp billing, payment
edit/delete, member points, per-line discounts (U3 has one sale-level discount, used as the fixture's "item
discount"), restoring a soft-deleted payment-method name.
