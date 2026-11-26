# UMKMall agent integration (MCP)

How UMKMall's agent reads and fills an owner's POS store. Plan:
[2026-11-26-001](plans/2026-11-26-001-feat-umk-1978-agent-mcp-plan.md) (UMK-1978, UMK-1979, UMK-1980 part, UMK-1982 part).
Every tool below is listed by the server in this order; `test/agent.e2e-spec.ts` fails when this list and the server
disagree.

## 1. Get an agent session

```http
POST /auth/agent/session
Content-Type: application/json

{ "token": "<the owner's UMKMall access token (auth_token)>" }
```

pos-api asks `${UMKMALL_WEB_URL}/api/auth/me` with the token as the `auth_token` cookie (5 s). It answers
`{ sessionToken, expiresIn: 900, tenant: { id } }`; 401 when UMKMall does not know the token, 503 when UMKMall
answers an error or does not answer, 422 for a token with characters a cookie cannot carry. The session lasts 15
minutes: ask again when it expires. The owner's store is created on first use, as at owner sign-in.

Locally, without UMKMall: `POST /auth/dev/agent-session { "userId": "<a public.users id>" }` (refused when
`NODE_ENV=production`).

An agent session reaches only the routes its tools use (`@AgentRoute()`), with `catalog.manage` and `reports.view`.
It never reaches staff, roles, devices, store settings, payment methods, expenses, sales, void or refund.

## 2. Connect

`POST /mcp`, MCP Streamable HTTP, stateless, JSON answers. Header `Authorization: Bearer <sessionToken>`. No token
→ 401; an owner or cashier token → 403.

- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL
  `http://localhost:3000/mcp`, header `Authorization: Bearer <token>`.
- **Claude Code:** `claude mcp add --transport http umkmall-pos http://localhost:3000/mcp --header "Authorization: Bearer <token>"`.

A tool answers JSON as text. A refusal is `isError: true` with one Indonesian sentence the agent can read back to the
owner (the route's own message and field errors); a server fault is always the same generic sentence, never details.

## 3. Write rules

Every write tool takes `idempotencyKey` (8 to 100 characters, required) and `confirm`.

- Without `confirm: true` it answers a preview (`preview: true` and what would change) and writes nothing. Show the
  preview to the owner, then call again with `confirm: true` and the same key.
- With `confirm: true` it runs once per key: a retry with the same key and input answers the first result. The same
  key with another input is refused ("sudah dipakai"); a refused write leaves the key free for a corrected retry.
- Money is integer rupiah. The server computes and validates every price.

## 4. Tools

### `search_products`
Catalog search. In: `q?`, `categoryId?`, `stock?` (`low` | `out`), `page?`, `perPage?` (1 to 100). Out: the
`GET /catalog/products` page (price, unit, units and tiers, `stock` null for non-stock items, `costPrice`).

### `get_product`
In: `productId`. Out: `GET /catalog/products/:id`.

### `get_product_stock`
In: `productId`. Out: `GET /stock/products/:id` (on hand and FIFO batches with unit cost).

### `list_categories`
Out: `GET /catalog/categories`.

### `store_summary`
In: `period?` (`today` | `week` | `month` | `year`). Out: `GET /reports/dashboard`.

### `sales_report`
In: `from`, `to` (YYYY-MM-DD, store timezone). Out: `GET /reports/sales`. For the finance ledger
(Rapikan Catatan Keuangan) and cashflow templates.

### `product_report`
In: `from`, `to`. Out: `GET /reports/products` (qty in base units, sales, cost, gross profit per product).

### `product_margins`
In: `from`, `to`. Out: the products report, each row plus `averagePrice`, `averageUnitCost` (rupiah, rounded),
`marginPercent` (one decimal; null without sales) and `hppRef` (the UMKMall HPP ref of an imported product, else
null). For "planned vs actual margin" against UMKMall's HPP.

### `profit_loss`
In: `period?` (`today` | `week` | `month`) or `from` and `to`. Out: `GET /reports/profit-loss` (revenue without tax,
cost of goods, gross profit, expenses by category, net profit, previous period).

### `purchasing_report`
In: `from`, `to`. Out: `GET /reports/purchasing` (received purchases per supplier and product, unit costs). Real
ingredient costs for the next HPP run.

### `create_category`
In: `name` + write controls. Out: the created category.

### `create_product`
In: `name`, `categoryId`, `sellingPrice` and the optional fields of `POST /catalog/products` (`sku`, `unit`,
`costPrice`, `type`, `lowStockThreshold`, `barcodes`) + write controls. A menu item made to order is `non_stock`.

### `update_product`
In: `productId` and the fields to change + write controls. The preview shows `before` and `after` of those fields.

### `import_hpp_products`
UMKMall HPP (Strategi Harga dan Profit, Kalkulator HPP) → POS catalog. In: `products` (1 to 50 rows of
`{ ref, name, cogs, price, unit? }`) + write controls.

- `ref`: the UMKMall HPP product id (letters, digits, `-`, `_`, up to 40). The POS product gets SKU `UMK-<ref>`; a ref
  imported before updates that product's cost and price (name and unit are kept as the owner left them).
- `cogs`: the variable cost per unit (ingredients and modal). **Never send UMKMall's `hpp`**: it adds allocated fixed
  costs, which the POS books as expenses, so profit would count them twice. Rounded up to whole rupiah.
- `price`: the selling price the owner chose (else the recommended one).
- New products are `non_stock` in category "Dari HPP UMKMall" (created when missing).
- Each row answers `action` (preview) or `result` (`created`, `updated`, `unchanged`, `error` with its message).

## 5. Not yet

Recording a sale, members, kasbon payments and suppliers (UMK-1981); purchase order and stock count drafts (rest of
UMK-1980); the full scripted end-to-end run (rest of UMK-1982).
