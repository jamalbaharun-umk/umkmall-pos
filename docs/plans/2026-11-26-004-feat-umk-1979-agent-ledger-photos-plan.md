# UMKMall agent: ledger feed and product photos

Epic UMK-1924, UMK-1979/UMK-1980 follow-up. Owner direction 2026-11-26: the POS provides the data UMKMall's tools
need ("kita cuma fokus sediain datanya"); the parity map (PRD v2, "Dukungan fitur UMKMall") left two gaps.

## Goal

- Catatan Keuangan (UMKMall's ledger) pulls the POS's money movements without double counting.
- A photo UMKMall made (Upgrade Foto Produk, Feed 9 Kotak, Kemasan Siap Jual) lands on the POS product.

## Design

- `GET /agent/ledger?from&to` (agent module, `@AgentRoute`, `reports.view`), cash basis, store timezone: sales by
  non-kasbon methods (paid − change), kasbon payments (down payment included), void returns, live expenses and
  supplier payments, manual drawer cash in/out. Stable ids `<kind>:<row id>`. Receipts only (`FINAL_SALE_STATUSES`).
  2000 entries per answer, `truncated` beyond. Tool `ledger_entries` (`pos.read`).
- `add_product_photo`: base64 in, multipart to the existing `POST /catalog/products/:id/images` over loopback (now an
  agent route, `pos.write`). Append only. `/mcp` JSON limit 3 MB, every other route 100 kB (`configureBody`).

## Definition of Done

- [test] The ledger lists each of seven movements once (two sales, down payment, instalment, refund, expense, cash
  out) with totals, local dates, labels and stable ids; another store's agent sees none.
- [test] A photo is added once per key; a non-image is refused; a read-only consent is refused; the agent still cannot
  delete a photo.
- [test] The `@AgentRoute` pin and the receipts-only guard include the new route.
- [cmd] lint, typecheck, tests, build.
