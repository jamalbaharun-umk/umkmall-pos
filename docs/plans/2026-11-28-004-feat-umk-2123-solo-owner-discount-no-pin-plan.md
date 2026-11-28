# feat(sales): a solo owner's own discount above 30% needs no PIN (UMK-2123)

Epic UMK-1924, issue UMK-2123. Owner decision 2026-11-28 (approved): "owner own discount without PIN in solo mode".
Server only; the till can skip the PIN prompt later from the flag below.

## Goal

In a store run by its owner alone (solo-owner mode, UMK-2120) nobody else exists to type a second PIN, so the 30%
gate of UMK-1990 (a line discount or a manual price more than 30% below the server's price, and the sale's combined
reduction above 30% of the list subtotal, ruling 2026-11-26 / PR 72) lets the owner's own sale through without a PIN
approval. Every other store and every other session keeps today's gate unchanged.

## Rules

1. **Solo** is `isSoloOwner(tx, s)` (`src/shifts/cash-ledger.ts`): no active, non-deleted `pos.staff` row. Read by
   the server inside the sale's transaction on every sale; never a client flag.
2. **Who:** a session of kind `owner` only. A `cashier` session never gets it (also in a store that looks solo). An
   `agent` session does not either: the agent sends no price and no discount (`record_sale` drops them, UMK-2069), so
   it has no discount path through this gate, and this change does not widen it. One helper,
   `soloOwnerSelfApproves(tx, s)` (`src/sales/solo-discount.ts`).
3. **What it covers:** every want of the gate (line approvals and the order approval). The approvals are not looked
   up; an approval id the request names anyway is left unused (as today for an approval named where none is needed).
4. **Recorded like a PIN approval, by the owner:** `sales.discount_approved_by` / `sale_lines.discount_approved_by`
   = the owner's actor id (the sale's detail shows "Pemilik"), and the same `discount_approval` audit rows with
   `approvedBy` = the owner and `approval: 'solo_owner'` in `details`. No migration, no new column.
5. **Unchanged:** the 100% refusals (`Diskon 100% tidak diperbolehkan`, `Harga manual tidak boleh Rp0`, a sale of
   server prices above Rp0 brought to Rp0), the `sales.price_override` permission, the owner's self-approval by PIN
   in a store with staff (`POST /sales/discount-approvals`), void and refund PIN rules.
6. **Told to the client:** `POST /sales/quote` and `GET /shifts/current` answer `discountPinRequired: boolean`
   (false exactly when rule 1 and 2 hold). The quote keeps its `…NeedsApproval` facts (the reduction is above 30%);
   the screen asks a PIN only when they are true and `discountPinRequired` is true.

## Definition of Done

- [test] Solo store, owner: a line discount above 30%, a manual price above 30% below, and an order discount pushing
  the combined reduction above 30% each sell without an approval; the sale and its lines carry the owner as approver,
  the audit rows carry `approval: 'solo_owner'`; quote and `/shifts/current` answer `discountPinRequired: false`.
- [test] The same store after one active staff member is added: the owner gets 422 `DISCOUNT_APPROVAL_REQUIRED`
  again and `discountPinRequired: true`; deactivating that member makes it solo again.
- [test] A cashier session (store with staff) is refused without an approval; a cashier of a store whose other
  staff are all inactive (looks solo) is refused too.
- [test] Solo owner: Rp0 by order discount, 100% line discount and a Rp0 manual price are still refused.
- [test] Solo owner: a void still needs the PIN (wrong / missing PIN refused).
- [test] Cross-tenant: store B solo does not unlock store A's owner (A has staff): A is refused.
- [test] Revert-red once: the helper always true fails the staff-store test; restored.
- [cmd] `npx tsc --noEmit` (pos-api), eslint on touched files, discount-gate / line-discounts / void / agent /
  solo-shift specs, then the full pos-api suite once.

## Files

- `apps/pos-api/src/sales/solo-discount.ts` (new): `soloOwnerSelfApproves`.
- `apps/pos-api/src/sales/sales.service.ts`: the gate in `insert`, `discountPinRequired` in `quote`.
- `apps/pos-api/src/shifts/shifts.controller.ts`: `discountPinRequired` on `GET /shifts/current`.
- `apps/pos-api/test/solo-discount.e2e-spec.ts` (new).

## Not in scope

The till screen skipping the PIN prompt (a later web change reads `discountPinRequired`). Any agent discount.
