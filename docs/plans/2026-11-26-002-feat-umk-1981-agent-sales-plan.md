# UMK-1981: MCP write tools for sales, members, receivable payments and suppliers

Epic UMK-1924. Owner go-ahead 2026-11-26 ("iya lanjut kesitu"). Follows plan 2026-11-26-001 (agent session, MCP server).

## Goal

UMKMall's agent records day-to-day business for the owner: a sale from a chat order, a new customer, a kasbon
instalment, a new supplier, and opens the shift when the owner asks.

## Rulings used (owner, 24 Nov 2026)

- The agent cannot void, cannot override a price, cannot move cash out of the drawer. One payment method per sale.
- No open shift: "Belum ada shift yang dibuka"; the agent may offer to open one, never opens it on its own.
- Sales by the agent go through the normal sale path (payment-api included when it is on).

## Design

- Shifts belong to an actor id. The agent session's actor is the owner's UMKMall user id, so its sales go into the
  owner's open shift, and a shift it opens is the owner's till. `actor_kind = 'agent'` on its rows, shown as
  "Agent UMKMall" on receipts and reports (a shift reads "Pemilik").
- `AgentSaleInput`: an agent's `POST /sales` takes no line price, no discount, no bank (422).
- `POST /sales/quote` gains `voucherCode` and `paymentMethodId`: with either it answers voucher discount, tax, total,
  rounding and amount due, as the sale would, writing nothing. The tool previews with it and pays the exact amount.
- Online methods are refused by the tool for now (no QR relay to the customer yet).
- Routes marked `@AgentRoute()` (pinned): `POST /sales`, `POST /sales/quote`, `GET /shifts/current`,
  `POST /shifts/open`, `GET /payment-methods`, `GET /members/picker`, `POST /members`, `GET /receivables`,
  `GET /receivables/:id`, `POST /receivables/:id/payments`, `GET /suppliers`, `POST /suppliers`.
- `pos.write` adds `sales.create`, `members.manage`, `receivables.manage`, `purchasing.manage`; member and kasbon reads
  need it too (personal data).
- Every write previews without `confirm`, runs once per agent key; the route's own Idempotency-Key is derived from it.

## Definition of Done

- [test] A sale through MCP equals the same sale at the till: subtotal, tax after discounts, total, rounding, paid,
  cost, shift.
- [test] No open shift → the clear error, nothing written.
- [test] Retry with the same key → one sale; one kasbon payment.
- [test] An agent's REST sale with a price or a discount → 422 (revert-red).
- [test] Read-only consent records nothing and reads no member, kasbon or shift data.
- [test] Cross-tenant: B's agent cannot sell A's product or pay A's kasbon.
- [cmd] docs/agent-integration.md lists the tools (drift test); lint, typecheck, tests, build green.

## Not in this change

Online methods through the agent; supplier payments and expenses "outside the drawer"; PO and opname drafts.
