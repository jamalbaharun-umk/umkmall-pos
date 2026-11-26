# UMKMall agent integration (MCP)

How UMKMall's agent (New Teman AI) reads and fills an owner's POS store. Plan:
[2026-11-26-001](plans/2026-11-26-001-feat-umk-1978-agent-mcp-plan.md) (UMK-1978, UMK-1979, UMK-1980 part, UMK-1982 part).
Every tool below is listed by the server in this order; `test/agent.e2e-spec.ts` fails when this list and the server
disagree.

The POS is one of UMKMall's tools in New Teman AI's sense: a **connection** ("UMKMall POS") that assistants and goals
are wired to, with the same registry description, consent, usage record and provenance as every other tool.

## 1. Get an agent session

```http
POST /auth/agent/session
X-Pos-Agent-Key: <POS_AGENT_SERVICE_KEY: the agent's own key, never the purge key>
Content-Type: application/json

{
  "token": "<the owner's UMKMall access token (auth_token)>",
  "scopes": ["pos.read", "pos.write"],
  "consentRef": "<UMKMall's consent record id>"
}
```

- **Server to server only.** Without the agent key (or with a wrong one, the purge key included) the route answers
  401 before UMKMall is asked: the scopes and consent are the caller's word, so only UMKMall's agent backend may ask.
  `POS_AGENT_SERVICE_KEY` unset → 404 (no agent sessions in that environment). At most 30 FAILED key checks per minute per
  network address (429 after that); requests with the right key are never limited here.
- `scopes`: what the owner consented to on UMKMall's Koneksi page. Reading and acting are separate permissions:
  `pos.read` (always granted) reads the catalog with cost and every report; `pos.write` also creates categories and
  products, records sales into the owner's open shift, members, kasbon payments and suppliers (UMK-1981), and reads
  member and kasbon data and the open shift (personal or till data). Without `pos.write` every write tool answers "izin pos.write" and changes nothing.
- `consentRef` (optional, `A-Z a-z 0-9 : . _ -`, up to 100): stored on every call record and in every write's
  provenance, so a result can be traced to the consent that allowed it.

pos-api asks `${UMKMALL_WEB_URL}/api/auth/me` with the token as the `auth_token` cookie (5 s) and answers
`{ sessionToken, expiresIn: 900, tenant: { id } }`; 401 when UMKMall does not know the token, 503 when UMKMall answers
an error or does not answer, 422 for a token a cookie cannot carry. The session lasts 15 minutes; ask again when it
expires. The owner's store is created on first use, as at owner sign-in.

**Set-Cookie comes back and must reach the owner's browser.** `/auth/me` can re-sign the access token and, once per
session, mint the refresh cookie (UMKMall `session.controller.ts`, `adoptWebRefreshSecret`). pos-api relays every
Set-Cookie it answers on this response, on success and on 503 alike. UMKMall's agent backend must pass them on to the
owner's browser with its own answer; dropping them signs the owner out of UMKMall later.

**Only UMKMall's agent backend may hold the token.** It is the owner's full UMKMall credential: whoever holds it can
also open an owner session (`POST /auth/umkmall/session`). Never send it to a model, a log, a browser script or a
third party. Follow-up: UMK-2059, an owner opt-in before any agent session is issued.

**The owner can turn the agent off from the POS, and it stays off:** `POST /agent/access/revoke` (owner session only)
refuses every agent session issued so far (401) and every new one (403, "Pemilik toko mematikan akses agent UMKMall")
until the owner calls `POST /agent/access/enable`. `GET /agent/access` answers `{ enabled }`. A store that never
touched the switch is on (UMK-2059 makes it an explicit opt-in).

Locally, without UMKMall: `POST /auth/dev/agent-session { "userId": "<a public.users id>", "scopes": [...] }`, only
when `NODE_ENV` is `development` or `test` (an unset `NODE_ENV` refuses it).

An agent session reaches only the routes its tools use (`@AgentRoute()`, pinned by `src/guards.spec.ts`). It never
reaches staff, roles, devices, store settings, payment methods, expenses, sales, void, refund, or a product edit.

## 2. Connect

`POST /mcp`, MCP Streamable HTTP, stateless, JSON answers. Header `Authorization: Bearer <sessionToken>`. No token
→ 401; an owner or cashier token → 403.

New Teman AI context, optional headers on every `/mcp` request (each `A-Z a-z 0-9 : . _ -`, up to 100; a malformed
one → 422 before any tool runs):

| Header | Meaning |
|---|---|
| `X-Umkmall-Goal` | the Target Bisnis goal the call serves |
| `X-Umkmall-Assistant` | the Asisten running it |
| `X-Umkmall-Run` | the run or session |
| `X-Umkmall-Mode` | `agentic` (the agent works, the owner approves) or `guided` (the agent drafts, the owner finishes) |

- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL
  `http://localhost:3000/mcp`, header `Authorization: Bearer <token>`.
- **Claude Code:** `claude mcp add --transport http umkmall-pos http://localhost:3000/mcp --header "Authorization: Bearer <token>"`.

A tool answers JSON as text. A refusal is `isError: true` with one Indonesian sentence the agent can read back to the
owner (the route's own message and field errors); a fault is always the same generic sentence, never details.

## 3. Registry, usage and provenance

- **Registry:** every tool in `tools/list` carries `_meta["umkmall/registry"]`: `scope` (`pos.read` | `pos.write`),
  `modes` (`agentic`, and `guided` for writes), `suits` (which UMKMall goal or tool it serves), `manualPath` (where
  the owner does it by hand in pos-web: the hand-over path when they say no or prefer to do it themselves),
  `connection: "UMKMall POS"` and `coinCost: 0` (coins are off).
- **Limits:** at most 300 `/mcp` requests per store per minute (429 with an Indonesian sentence).
- **Usage:** every call is recorded in `pos.agent_tool_calls` (kept 180 days): tool, outcome (`ok`, `preview`, `refused`), the four
  context headers, the consent, the user acted for, the ids a write created and the duration. Never the input or the
  answer. Read it with `agent_activity` (or `GET /agent/activity` as the owner).
- **Provenance:** every confirmed write answers `provenance`: `source: "umkmall-pos"`, `tool`, `by: "agent"`,
  `actorId`, `goalRef`, `assistantRef`, `runRef`, `consentRef`, `at`. Hasil Saya and Rapor Goal can keep it as the
  result's source.

## 4. Write rules

Every write tool takes `idempotencyKey` (8 to 100 of `A-Z a-z 0-9 : . _ -`, required) and `confirm`, and needs the
`pos.write` scope.

- Without `confirm: true` it answers a preview (`preview: true` and what would change) and writes nothing. Show the
  preview to the owner, then call again with `confirm: true` and the same key.
- With `confirm: true` it runs once per key: a retry with the same key and input answers the first result; the same
  key with another input is refused ("sudah dipakai").
- A write the POS refused (a 4xx: bad input, a missing category) frees the key for a corrected retry. A write whose
  answer was lost (no answer or a 5xx) keeps the key and answers "belum pasti". For `record_sale` and
  `record_receivable_payment` send it again with the **same** key: the tool replays the lost call (the exact body it
  sent) under the route's own idempotency key, which answers the first result and never records twice; never use a
  new key there. For the other writes check the catalog first, and use a new key only if it is really not there.
  Keys expire after 7 days. The stored answer keeps no phone, address or customer name (`memberName`, a member's
  `name`): a replay answers without them; read them again with `search_members` if needed.
- **The agent never changes an existing product** (owner ruling 24 Nov 2026: no price change, no void, no drawer cash):
  it creates categories and products with one base price, and HPP imports create new SKUs only. Price changes are the
  owner's, in the POS.
- Money is integer rupiah. The server validates every price.

## 5. Tools

### `business_context`
The business layer of New Teman AI context: `store` (name, business type, address), `categories`, `productCount`,
`thisMonth` (the dashboard for this month). Read it at the start of a session instead of asking the owner to
re-explain their business.

### `search_products`
Catalog search. In: `q?`, `sku?` (exact, e.g. `UMK-<ref>`), `categoryId?`, `stock?` (`low` | `out`), `page?`,
`perPage?` (1 to 100). Out: the `GET /catalog/products` page (price, unit, units and tiers, `stock` null for
non-stock items, `costPrice`).

### `get_product`
In: `productId` (uuid). Out: `GET /catalog/products/:id`.

### `get_product_stock`
In: `productId` (uuid). Out: `GET /stock/products/:id` (on hand and FIFO batches with unit cost).

### `list_categories`
Out: `GET /catalog/categories`.

### `store_summary`
In: `period?` (`today` | `week` | `month` | `year`). Out: `GET /reports/dashboard`.

### `sales_report`
In: `from`, `to` (YYYY-MM-DD, store timezone). Out: `GET /reports/sales` without the `cashier` of each line (staff
names stay in the POS). For Catatan Keuangan and the cashflow and capital templates.

### `product_report`
In: `from`, `to`. Out: `GET /reports/products` (qty in base units, sales, cost, gross profit per product).

### `product_margins`
In: `from`, `to`. Out: the products report, each row plus `averagePrice`, `averageUnitCost` (rupiah, rounded),
`marginPercent` (one decimal; null without sales) and `hppRef` (the UMKMall HPP ref of an imported product, else
null). For "planned vs actual margin" in Strategi Harga dan Profit.

### `profit_loss`
In: `period?` (`today` | `week` | `month`) or `from` and `to`. Out: `GET /reports/profit-loss` (revenue without tax,
cost of goods, gross profit, expenses by category, net profit, previous period).

### `purchasing_report`
In: `from`, `to`. Out: `GET /reports/purchasing` (received purchases per supplier and product, unit costs). Real
ingredient costs for the next HPP run.

### `agent_activity`
In: `days?` (1 to 90, default 7), `limit?` (1 to 500, default 100). Out: the store's agent calls, newest first (see
section 3).

### `hpp_product_data`
Everything UMKMall's HPP calculators need, pulled from the POS (owner direction 26 Nov 2026: UMKMall pulls the
products and does the calculation; the POS provides the data). In: `from`, `to`, `q?`, `page?`, `perPage?` (1 to 100,
default 50). Out: `products`, one row each with `sellingPrice`, `costPrice`, `units`, `priceTiers`, `stock`, `hppRef`,
`sold` (qty, sales, cost, average price and unit cost in the period) and `purchases` (qty, total, average and last
unit cost, last date: what buying it really cost); `operatingExpenses` (total and by category: fixed-cost
candidates); `period` (revenue and gross profit); paging; `purchasesTruncated` when the period's purchase lines were
more than the report shows.

### `create_category`
In: `name` + write controls. Out: the created category and `provenance`.

### `create_product`
In: `name`, `categoryId`, `sellingPrice` and optionally `sku`, `unit`, `costPrice`, `type`, `lowStockThreshold`,
`barcodes` + write controls. No extra units, wholesale tiers or deactivation. A menu item made to order is `non_stock`.

### `import_hpp_products`
UMKMall HPP (Strategi Harga dan Profit, Kalkulator HPP) → new POS products: the "Pakai di POS" step. In: `products`
(1 to 50 rows of `{ ref, name, cogs, price, unit? }`) + write controls.

- `ref`: the UMKMall HPP product id (letters, digits, `-`, `_`, up to 40). The POS product gets SKU `UMK-<ref>`.
- `cogs`: the variable cost per unit (ingredients and modal). **Never send UMKMall's `hpp`**: it adds allocated fixed
  costs, which the POS books as expenses, so profit would count them twice. Rounded up to whole rupiah.
- `price`: the selling price the owner chose (else the recommended one).
- A new ref becomes a `non_stock` product in category "Dari HPP UMKMall" (created when missing): `action: "create"`,
  then `result: "created"`.
- A ref whose SKU already exists, imported before or made by hand, is left exactly as it is: `action`/`result`
  `"exists"`, with `current` (its cost and price now) next to the proposed `costPrice` and `sellingPrice`, so the
  owner can decide and change it in the POS (`manualPath`).
- A row the POS refused answers `result: "error"` with its message; a row whose answer was lost answers `"unknown"`.

### `list_payment_methods`
Out: `GET /payment-methods` (id, name, `kind`: cash, debit, credit = kasbon, wallet = QRIS toko, online).

### `list_suppliers`
Needs `pos.write` (phones and addresses). Out: `GET /suppliers`.

### `current_shift`
Needs `pos.write`. Out: `GET /shifts/current`: the owner's open shift (sales, expected cash) or `shift: null`.

### `search_members`
Needs `pos.write`. In: `q?` (name or code). Out: `GET /members/picker`.

### `list_receivables`
Needs `pos.write`. In: `memberId?`, `status?` (`open` | `settled` | `cancelled`), `q?`, `page?`, `perPage?`. Out:
`GET /receivables` (each kasbon with `rest`, the balance left).

### `open_shift`
In: `openingCash` + write controls. Opens the owner's shift. **Only when the owner asks**: the agent never opens a
shift on its own to record a sale (owner ruling 24 Nov 2026). Refused when a shift is already open.

### `record_sale`
In: `lines` (`productId`, `qty`, `unit?`), `memberId?`, `voucherCode?`, `paymentMethodId?` (default Tunai),
`downPayment?` (kasbon only, default 0), `note?` + write controls.

- The sale goes into the owner's open shift; with none open the tool answers "Belum ada shift yang dibuka" and records
  nothing.
- **The agent never sends a price or a discount** (an agent's `POST /sales` refuses `price` and `discount`, 422). The
  preview is the server's full quote (`POST /sales/quote` with the method: line prices with units and wholesale tiers,
  voucher discount, tax after discounts, total, cash rounding, amount due).
- The preview also says `wouldPay` (and `kasbonRest` for kasbon) and refuses a kasbon without a member or with a down
  payment that leaves nothing owed. Stock is checked at confirm only (the sale's own lock).
- On confirm the tool pays the exact amount: cash pays the amount due (rounded up to Rp100), debit and QRIS the total,
  kasbon `downPayment` (the rest becomes the member's receivable).
- Online methods are refused for an agent session by the sale itself (422 on `paymentMethodId`), not only by the tool. One payment method per sale. The route's own `Idempotency-Key` is derived from
  the agent key, so a retry with the same key is deduplicated by the tool and again by the route. The receipt names the seller "Agent UMKMall".

### `create_member`
In: `name`, `code?`, `phone?`, `address?` + write controls. Send the store's own code when known; otherwise one is
made up from the key (`AG` + 10 hex), and a collision answers 409: send a `code` then.

### `record_receivable_payment`
In: `receivableId`, `amount`, `paymentMethodId?` (default Tunai: cash goes into the owner's open shift) + write
controls. The preview shows `balanceBefore` and `balanceAfter` and refuses an amount above the balance, as the
confirm does.

### `create_supplier`
In: `name`, `phone?`, `address?` + write controls.

### `ledger_entries`
The POS's money movements for UMKMall's Catatan Keuangan, cash basis (`GET /agent/ledger`, `reports.view`). In:
`from`, `to`. Out: `entries`, each `{ id, date, direction, kind, category, label, amount, method, receiptNumber, note }`
with a stable `id` (`sale:`, `kasbon_payment:`, `refund:`, `expense:`, `cash:` + the POS row id), so a repeated pull
can be deduplicated; `totals` (in, out, net); `truncated` past 2000 entries (ask shorter periods). Kinds:

| kind | direction | What it is |
|---|---|---|
| `sale` | in | a sale paid by a non-kasbon method: the money received (paid minus change) |
| `kasbon_payment` | in | a kasbon payment, the down payment included |
| `refund` | out | money given back when a sale was voided, per payment returned |
| `expense`, `supplier_payment` | out | live (not voided) expenses and supplier payments, `category` from the POS list |
| `cash_in`, `cash_out` | in, out | drawer cash put in or taken out by hand, `category` = the reason (`tambah_modal`, `setor_bank`, `ambil_pemilik`, `lainnya`) |

A kasbon sale itself brings in no money (only its payments do). The POS categories are the POS's; UMKMall maps them
to its own (for example `ambil_pemilik` → uang pribadi, `setor_bank` → a transfer). Data only: nothing is written.

### `add_product_photo`
In: `productId`, `imageBase64` (JPG, PNG or WebP, at most 2 MB, no `data:` prefix) + write controls. Adds a photo to
the product (`POST /catalog/products/:id/images`), e.g. the result of Upgrade Foto Produk. **Append only**: the agent
never deletes or replaces a photo and never edits the product; the owner manages photos in the POS. The preview checks
the product and the size; the idempotency record keeps the photo's sha256, not the photo. `/mcp` accepts bodies up to
3 MB for this tool (every other route keeps 100 kB).

## 6. Not yet

Online payment methods through the agent; supplier payments and expenses "outside the drawer"; purchase order and
stock count drafts (rest of UMK-1980); the full scripted end-to-end run (rest of UMK-1982).
