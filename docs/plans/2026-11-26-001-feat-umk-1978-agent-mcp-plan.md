# UMK-1978, UMK-1979, UMK-1980 (part), UMK-1982 (part): agent session and MCP server for UMKMall's agent

Epic UMK-1924. Owner request 2026-11-26: the POS must support UMKMall's tools and Mini Learning Journeys (MLJ), HPP
first ("our entry point"). Research: [HPP UMKMall × POS proposal](https://claude.ai/artifact/VWM66Xu4F7j9TxHPVSubUw).

## Goal

UMKMall's agent, acting for a signed-in owner, reads and fills that owner's POS store over MCP. HPP results become POS
products with cost and price, and the POS answers the figures UMKMall's tools need (per-product margin for HPP, sales,
profit and loss and purchases for the finance ledger, catalog and stock for chat replies).

## What UMKMall needs from the POS (map)

| UMKMall surface | POS tool(s) in this change |
| --- | --- |
| Strategi Harga dan Profit (Price Optimizer, HPP) | `import_hpp_products` (write), `product_margins`, `product_report` |
| Kalkulator HPP (chat template), Hitung Kebutuhan Modal, Simulasi Cashflow (templates) | `sales_report`, `profit_loss`, `purchasing_report`, `store_summary` |
| Rapikan Catatan Keuangan (journey and ledger tool) | `sales_report`, `profit_loss`, `purchasing_report` |
| Chat Jadi Order, Cek chat, Balasan siap pakai | `search_products`, `get_product`, `get_product_stock` (recording a sale is UMK-1981, not here) |
| Kemasan Siap Jual, Label Saya, Upgrade Foto, Feed 9 Kotak | `search_products`, `get_product` (names and prices for labels and captions) |
| Template Invoice, Checklist Operasional Harian | not served yet (sale receipt and shift reads come with UMK-1981) |

## Rulings used

- Agent session (UMK-1978): `kind: 'agent'`, signed and verified only in `src/tenancy/session.ts`, 15 minutes.
  `POST /auth/agent/session { token }` takes the owner's UMKMall access token and asks
  `${UMKMALL_WEB_URL}/api/auth/me` with it as the `auth_token` cookie only (the route reads the cookie; this settles
  the open "Bearer?" question without a UMKMall change). 5 s; 401 → 401, 5xx or timeout → 503. A Set-Cookie it
  answers is not relayed: the agent holds no browser, and without `auth_refresh` no refresh cookie is minted.
  `POST /auth/dev/agent-session { userId }` for local work, refused when `NODE_ENV=production`.
- Agent permissions (`AGENT_PERMISSIONS`): `catalog.manage`, `reports.view`. Not: staff, roles,
  devices, price override, void or refund, payments, expenses, drawer cash, sales (UMK-1981 adds those it may have).
  An agent session reaches only routes marked `@AgentRoute()` (an allow-list in the session guard), so store
  settings, payment methods and every new route stay closed to it whatever permission they ask.
- MCP (UMK-1979): `POST /mcp`, official SDK, Streamable HTTP, stateless, Bearer agent token (none or bad → 401;
  an owner or cashier token → 403). Each tool calls the existing pos-api route over loopback with the caller's own
  token, so validation, tenant filters, permissions and cost hiding are the routes' own. A refused call answers the
  route's Indonesian message and field errors, never internals; a 5xx answers one generic sentence.
- Write tools (UMK-1980 rules): without `confirm: true` a tool answers what it would do and changes nothing.
  `idempotencyKey` is required; a retry with the same key and input answers the first result; the same key with
  another input answers an error. Keys live in `pos.agent_requests` (tenant, key, tool, request hash, answer).
- HPP import: one row per HPP product `{ ref, name, cogs, price, unit? }`. SKU `UMK-<ref>` is the link to the UMKMall
  product, so a second import updates instead of duplicating. `cost_price = ceil(cogs)`: the variable cost only;
  UMKMall's `hpp` includes allocated fixed costs, which the POS books as expenses, so it is never sent. New products
  are `non_stock` in category "Dari HPP UMKMall" (created when missing). At most 50 rows per call; each row answers
  `created`, `updated`, `unchanged` or its error.
- `product_margins`: the products report plus per-product average price, average unit cost and margin %, computed in
  integer rupiah (rounded) and one-decimal percent, so the agent does no arithmetic.

## Definition of Done

- [test] Agent session: 200 → an agent token for the owner's tenant; 401, 5xx and timeout mapped; only the
  `auth_token` cookie is sent; dev variant refused in production.
- [test] An agent token gets 403 on a route outside `AGENT_PERMISSIONS` and on any route not marked `@AgentRoute()` (settings, payment methods, staff).
- [test] MCP: a client lists the tools and calls each read tool against a seeded store; answers match REST.
- [test] Cross-tenant: store B's agent reads none of store A's data and cannot update A's product.
- [test] No token → 401 on `/mcp`; an owner token → 403.
- [test] Bad tool input → an Indonesian error the agent can read, no stack.
- [test] `import_hpp_products`: preview changes nothing; confirm creates, a second import updates; same key retry → same answer,
  nothing written twice; same key with another input → refused; fractional cogs rounded up; never `hpp`.
- [test] `agent_requests` has RLS and `tenant_id` (the existing db and purge guards).
- [cmd] `docs/agent-integration.md`: session, every tool, preview/confirm, idempotency, connecting MCP Inspector or
  Claude Code; a test fails when its tool list drifts from the server's.
- [cmd] lint, typecheck, test, build green.

## Files

`src/tenancy/session.ts`, `src/staff/staff-access.ts`, `src/staff/permissions.ts`, `src/staff/require-permission.ts`,
`src/auth/auth.controller.ts`, new `src/agent/` (module, controller, tools, idempotency), `db/schema/agent.ts` + one
migration, `app.module.ts` (one line), `docs/agent-integration.md`, `test/agent.e2e-spec.ts`.

## Not in this change

Sales, members, receivable payments and suppliers over MCP (UMK-1981); purchase order and opname drafts (rest of
UMK-1980); the full scripted harness (rest of UMK-1982); UMKMall's side (persistent HPP products, "Pakai di POS").
