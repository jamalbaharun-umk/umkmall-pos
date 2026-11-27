# UMK-1970: undo a supplier return, record the money a supplier hands back (feature 29 additions)

Goal: two additions to feature 29 that the owner approved. (1) A purchase return recorded by mistake can be undone: the
goods go back into stock and the debt rises again. (2) When returns (or payments) put a purchase above its total, the
money the supplier hands back (`refundDue`) is recorded as cash received, into the cashier drawer or the store cash,
instead of staying a note outside the system. Builds on
[2026-11-26-008](2026-11-26-008-feat-umk-1970-purchase-payments-returns-plan.md).

## Rulings taken here

- **Figures.** P = live payments, R = returns not undone, F = live refunds received, T = total. Debt
  `remaining = max(0, T - R - P)` (unchanged). Gross credit `credit = max(0, P + R - T)`: what the supplier owes back.
  `refundDue = credit - F`: what is still to come back. Invariant **F <= credit**, held under the purchase row lock by
  every write that changes P, R or F, so a refund never counts as debt and `refundDue` is never negative.
- **Undo a return** ("Batalkan retur"): `POST /purchasing/orders/:id/returns/:returnId/reverse` with a required reason.
  Append-only: one `purchase_return_reversals` row per return (unique), the return and its lines stay unchanged. Every
  line's units go back into the batch they left, at that batch's cost (StockService `undoReturnToSupplier`, the batch
  row lock, stock reason `purchase_return_reversal`), and the debt rises by the return's total. Stock sold since does not
  matter. A repeat answers the first reversal and changes nothing (idempotent by the unique row; the purchase lock
  orders two concurrent ones). Refused when it would break something: the purchase is not approved
  (`PURCHASE_NOT_APPROVED`); the refunds already received would exceed the credit left after the undo
  (`RETURN_REFUNDED`, with `refunded`: void the refund first); the batch would hold more than it received
  (`RETURN_UNDO_BATCH_FULL`, a safety net no normal flow reaches).
- **Money back from the supplier** ("Terima uang retur"): `POST /purchasing/orders/:id/refunds` with an
  `Idempotency-Key` (same rules as a payment), `amount`, `destination` `drawer` (Laci kasir) or `store_cash` (Kas
  toko), optional note. Partial allowed, never above `refundDue` (`REFUND_EXCEEDS_DUE`, with `refundDue`). Drawer: a
  person at the till (`AGENT_FORBIDDEN`), `sales.create` (`DRAWER_PERMISSION`, after the replay checks), the actor's own
  open shift (`SHIFT_REQUIRED`); one shift cash entry of the new kind `purchase_refund` (in). Store cash: one store cash
  entry of the new kind `purchase_refund` (in).
- **Void a refund**, the same way as a payment: `POST …/refunds/:refundId/void` with a reason; the row stays, marked
  voided. A drawer refund whose shift is still open gets a `purchase_refund_reversal` cash-out entry in that shift
  (refused with `DRAWER_INSUFFICIENT` when that drawer no longer holds the amount); a closed shift never changes, so the
  cash leaves the store cash (`purchase_refund_void`, out); a store cash refund leaves the store cash the same way. A
  repeat changes nothing.
- **Voiding a payment** now also keeps the invariant: refused with `REFUND_RECEIVED` (with `refunded`) when the refunds
  received would exceed the credit left after the void.
- Reporting: the shift report and the drawer screens gain `purchaseRefunds` / `purchaseRefundReversals`; the agent
  ledger gains live refunds as `supplier_refund` entries (in, one added line in `src/agent/`). Not income in profit and
  loss: it gives back money paid for goods.
- Permissions: `purchasing.manage` for all four routes (no new key). Amounts stay hidden from actors without cost
  visibility, as before (`refunded`, `refundDue` join the hidden money fields).

## Definition of Done

1. [test] Undo a return: stock back into the same batch (qty and a `purchase_return_reversal` movement), debt back up,
   return listed with its reversal, a repeat changes nothing; refused with a refund received (`RETURN_REFUNDED`,
   revert-red once); after a sale drew from the batch the undo still works.
2. [test] Refund into the drawer (expected cash up, new kind in the shift report) and into store cash (balance up);
   partial then the rest; above `refundDue` refused (`REFUND_EXCEEDS_DUE`, revert-red once); no shift
   `SHIFT_REQUIRED`; replay answers the first; another body under the key `IDEMPOTENCY_KEY_REUSED`.
3. [test] Void a refund: open shift reversal (expected cash down), closed shift → store cash out; repeat unchanged;
   voiding a payment that the refund depends on is refused (`REFUND_RECEIVED`, revert-red once).
4. [test] Concurrency: two refunds of the whole `refundDue` at once: one 201, one `REFUND_EXCEEDS_DUE`; an undo and a
   refund at once never leave refunds above the credit; two undos of one return write one reversal.
5. [test] Cross-tenant 404 for reverse, refund and refund void; 403 without `purchasing.manage`.
6. [test] Guard: the new tables and ledger kinds are written only in `purchase-payments.service.ts`; the reversal
   table is append-only.
7. [test] `debtOf` unit tests with refunds; pos-web vitest for the new helpers (refund notice, history rows, codes).
8. [cmd] `npm run lint && npm run typecheck && npm run build`, pos-web `npx vitest run`, pos-api suites.
9. [qa] Browser at 375 and 1024: undo dialog, refund dialog, void refund, toast and error dialog.

## Files

- api: `src/db/schema/purchase-payments.ts` (two tables), `shift-cash.ts`, `store-cash.ts`, `stock.ts` (kinds and
  reason), one new migration; `src/purchasing/debt.ts`, `purchase-payments.service.ts`, `purchasing.service.ts`,
  `purchasing.controller.ts`; `src/stock/stock.service.ts`; `src/shifts/cash-ledger.ts`; `src/reports/reports.service.ts`;
  `src/agent/ledger.controller.ts` (one line); `src/guards.spec.ts`.
- web: `routes/pembelian/` (`-api.ts`, `-debt.ts` + test, `-money-dialogs.tsx`, `$id.tsx`), `routes/kasir/-shift-helpers.ts`
  (labels and drawer rows).
- tests: `test/purchase-payments.e2e-spec.ts`, `src/purchasing/debt.spec.ts`.
