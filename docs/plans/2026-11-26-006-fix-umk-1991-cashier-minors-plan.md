# UMK-2053: cashier pending-sale minors (PR 28 review)

Goal: fix the real, cheap minors of the cashier screens' pending-sale logic. Web only (`apps/pos-web`), no pos-api change.

## Definition of Done

1. [test] `pay()` clears the stored cart only on what ITS `sale_paid` produced (`paidBy(before, after)`), never on a stale `completed` of an older sale.
2. [test] A paid answer that lands while no register is mounted is shown (receipt, change, cart cleared) when the register opens: `Completed.seen` + `completed_seen`, replacing the mount-time seq snapshot.
3. [test] `timeoutMs()` is 15 s, and at least 2 x `PAYMENT_API_TIMEOUT_MS` + 3 s when pos-web sees that variable (a switch to cash makes two payment-api calls); `POS_API_TIMEOUT_MS` still wins. Idempotency of the multi-call actions is a pos-api matter (listed as skipped).
4. [test] The browser-side no-answer text of `createSale` says to reload and check Riwayat.
5. [test] After a held cash sale is reopened, "Sudah tercatat: kosongkan keranjang" empties the cart with the ack (the lines are not carried into a new key); the plain ack stays for "not recorded".
6. [test] Header table of `-pending.ts` lists `completed`, the recorded-on-reopen rule and the clean fresh key; stacked doc comments merged.
7. [cmd] Gate: root lint, typecheck, build, pos-web vitest. [qa] Pay dialog notice at 375/768/1024.

## Skipped (reason in the commit/report)
- Storage-write failure plus clean fresh key: the page cannot know what a failed write lost; UMK-2052 already warns. 
- Browser timeout on the `createSale` server function: not abortable without losing the "request out" truth; the hint covers it.
- Multi-call idempotency of refund/void/uploads: server side (another agent).
