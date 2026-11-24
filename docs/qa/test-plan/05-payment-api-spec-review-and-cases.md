# QA review of "Payment-api: alur pembayaran PG dan kasus tepi" and test cases per code

Spec reviewed: Claude Doc "Payment-api: alur pembayaran PG dan kasus tepi" (rev 9, 9 base rules, status table, three
confirmation paths, flow pos-api <-> payment-api, D1-D10, M1-M13, V1-V7). This file has (A) findings, (B) a test per
spec code, (C) tests for the proposed new codes. Test names in code must contain the case code, e.g.
`it('D7 webhook twice + manual check + reconcile race', ...)`.

All tests run against the fake PG adapter (knobs: latency, timeout-after-success, duplicate/reorder/drop webhook, paid-after-expiry,
different amount, refuse refund, not-found-then-found, cancel-unsupported, net-amount reporting) and a fake clock.

## A. Findings, most serious first

Status: all 16 findings were adopted in spec rev 15. Differences from the proposed fixes: M14, M5 and M7 follow the D11 pattern (failed/expired/cancelled never become paid; late money becomes an unmatched receipt that is auto-refunded). "Supervisor" = any actor with `sales.void`. Owner decisions 24 Nov: late payment auto-refund; shift close refused while a sale awaits payment; QR validity 15 minutes. D13 and M19 were approved by the owner as proposed; the spec is final.

| # | Sev | Code | Finding | Proposed fix |
|---|---|---|---|---|
| 1 | High | D11 (new) | Rule 1 makes a unique index on (tenant, order ref) for `created/pending/paid`. D4 (second payment on same order), M5 (late payment on an expired/cancelled charge while the cashier already started a new charge, see D6) and M7 produce a SECOND `paid` row or an `expired -> paid` move for an order that already has an active/paid payment. The database would reject it, so `settle` fails and real money is neither recorded nor refunded. | Record late and duplicate money in a separate table/row type that is outside the unique index (for example `extra_receipts`, status `needs_review`), always insertable, and refund from there. Test: settle never fails on a unique violation. |
| 2 | High | M15 (new) | M12 says a CASHAC payment already `paid` whose sale did not finish is auto-VOIDED after 10 minutes because the cashier "never saw success". The cashier may have physically taken the cash and handed over goods (screen lost after the money moved). Auto-void then deletes a real sale, returns stock that left the store, and the drawer is over. It also bypasses rule "void needs permission + admin PIN + reason". | Do not void. Complete the sale the same way as M4 (outbox/job) because `paid` is already recorded; alert if the cashier never confirms. If the owner wants cancellation it is a normal PIN void. |
| 3 | High | D12 (new) | Charge Idempotency-Key = the sale's key (step 2) and D10 "same sale resent returns the same QR". After the QR expires, the cashier needs a NEW charge for the same sale (D6), but the same key must return the OLD expired payment. Either a new QR can never be created for that sale, or the key rule is broken. | Key = sale id + attempt number (new attempt only after the old payment is terminal). Spec the response of the old key after expiry. |
| 4 | High | M14 (new) | Transition table has no `failed -> paid`. D3 and the reconcile rule mark `created` payments that "never reached the PG" as `failed`, but PGs can lag (the charge exists but lookup says not found) or accept the original timed-out call later. Customer pays, money arrives on a `failed` payment, no rule applies. | Add `failed -> paid + needs_review` like `expired`. Do not mark `failed` on a single "not found"; require a delay or a second lookup, and keep the reference reserved at the PG. |
| 5 | High | M16 (new) | Ordering across services: payment becomes `expired`, pos-api cancels the sale and releases stock; then a late `paid` outbox message arrives. Spec says pos-api completes the sale on paid (step 5) and cancels it on expired (step 6) but not what wins when both arrive. A completed sale on released stock = oversell. | pos-api: `paid` for a `cancelled` sale never completes it; it answers "ack" and leaves the payment `needs_review`/refund (M5). Test both arrival orders. |
| 6 | Med | D13 (new) | D5 depends on the PG being able to close an unpaid dynamic QR. Many PGs cannot cancel a QRIS; "cancelled" would never be reachable, the cashier cannot switch to cash until expiry (10 min), and a customer waiting in line gets stuck. If PG is unreachable the same happens. | Adapter declares `canCancel`. If false, the screen must say the QR stays valid until expiry and either block cash until then or accept cash and auto-refund a later QR payment (decide with owner). Test both adapter capabilities. |
| 7 | Med | M17 (new) | pos-api can be unable to reach payment-api for a long time while sales are `awaiting_payment`: stock reserved, shift cannot close (rule), no escape. A manual cancel while payment-api is down could cancel a sale that was actually paid. | Cancel only after payment-api confirms terminal status; owner view lists hanging sales with age; shift-close message names them; after payment-api returns, reconcile runs first. |
| 8 | Med | M18 (new) | "Nominal must be exactly equal" (rule 6, M8). Some PGs report net-of-fee or fee-added or unique-code amounts (QRIS fee, VA admin fee). Exact-equal would flag every payment as mismatch, or accept wrong money. | Adapter normalises to gross charged amount and exposes `feeAmount`; mismatch only when gross differs. Test net-amount reporting. |
| 9 | Med | V8 (new) | V3: sale is cancelled and stock restored once the PG ACCEPTS the refund request, but V4 shows the PG can later refuse (`refund_failed`). Sale/stock/revenue are reversed while the money is still in the store's PG balance and the customer is unpaid. | Keep sale reversal, but show an owner liability "uang pelanggan belum dikembalikan Rp X" in reports until refunded or marked manual; P&L must not double count. |
| 10 | Med | V9 (new) | M5/D4/M8 auto-refund has no human approver, while the void/refund rule needs an admin PIN, and the spec mentions "PIN admin atau supervisor" (no supervisor role exists in the owner rules). | Define system-initiated refunds as actor `system` (no PIN), audited; clarify "supervisor" or remove it. |
| 11 | Med | M19 (new) | M13: store deletion refused while a payment is pending/refunding. Erasure has a 30-day grace and a legal duty; a payment stuck forever blocks erasure forever. | Add a maximum age after which pending items are force-resolved (expire/refund) and erasure proceeds; test the purge endpoint answer (409 with reason, then success). |
| 12 | Med | M20 (new) | Inbox events retried with growing delay (webhook step 5). A poison event (always fails to process) retries forever. | Max attempts then park with alert; other events for the same payment are not blocked behind it; reconcile still settles. |
| 13 | Med | M21 (new) | Daily PG-vs-us reconciliation will give false `needs_review` at day boundaries (PG settlement lag, UTC vs store timezone) and the reverse direction ("paid here, not at PG") is more dangerous (a forged/duplicated local paid). | Define cut-off and tolerance window; "paid here, absent at PG" blocks nothing automatically but alerts as high severity. |
| 14 | Low | M22 (new) | "CASHAC `created -> paid` immediately" and kasbon: a kasbon receipt is not paid by the customer. Also kasbon instalments paid by QRIS-store/transfer (design 4) have no stated order reference. | State that kasbon creates a receivable, not a paid payment, and that instalments are separate payments with order ref = receivable id (even when manual). |
| 15 | Low | testability | M1 "worst case about 3 minutes" needs a fake clock and defined schedule; M5 "kasir dan pemilik diberi tahu" has no named surface; D4 "QR sekali pakai" depends on adapter capability; polling every 3 s and PG at most once per 5 s needs a defined cached answer. | Name the notification surface (owner screen list + cashier banner); adapter declares `singleUseQr`; spec the cached status answer. |
| 16 | Low | rule 5 | "Status only moves forward" has no defined order, so tests cannot check it. | Give a numeric rank: created(0) < pending(1) < failed/expired/cancelled(2) < paid(3) < refund_pending(4) < refunded/refund_failed/voided(5), and list the only allowed backward-looking exceptions. |

## B. Tests for existing codes

Type auto-api unless noted. Each asserts at the end the **balance check**: sum(paid payments) = sum(completed PG sales)
(+ listed `needs_review` extras); stock, voucher quota and drawer ledger as expected; exactly one receipt number.

| Code | Pri | Test |
|---|---|---|
| D1 | P0 | Two Bayar requests, same key, 50 ms apart and truly concurrent: one sale, one payment, one PG charge; UI button disabled after first tap (auto-ui) |
| D2 | P0 | pos-api request to payment-api times out (response dropped), retried: same payment returned; same key + different amount/order ref = 409/422, original untouched |
| D3 | P0 | PG create succeeds but response lost: payment-api looks up by our reference, adopts it; fake PG charge count = 1. Variant: PG says not found: re-create with same reference/key; count = 1 |
| D4 | P0 | Fake PG reports two payments for one charge: second stored separately as `needs_review`, refunded once; sale completed once; second QR scan rejected by adapter when `singleUseQr` |
| D5 | P0 | Cancel while pending, PG closes: `cancelled`, cash then allowed. Cancel while PG already paid: cancel refused, sale completes as QRIS. Cancel while PG unreachable: stays pending, cash blocked (see D13 for no-cancel PG) |
| D6 | P0 | New QR for same sale: refused while old is created/pending; allowed after old is terminal; money arriving on old QR = late payment (M5), refunded, not applied to the new one |
| D7 | P0 | Webhook x2 + manual sync + reconcile at the same instant (barrier): one transition, one outbox row, one pos-api completion, one receipt. Revert-red: remove row lock in `settle`, test fails; restore |
| D8 | P0 | Outbox `paid` delivered 2-5 times and out of order: one receipt number, one drawer row |
| D9 | P0 | Refund requested twice (same key and different key): one PG refund, second returns the first |
| D10 | P0 | Resend of the same pending sale: same sale id, same QR/VA, charge count 1; after expiry see D12 |
| M1 | P0 | No webhook ever: fake clock; paid recorded by polling (<=3 s), by manual sync, and by reconcile no later than defined bound (assert <= 3 min) |
| M2 | P0 | Webhook before the PG response was stored: `created` row exists; `created -> paid` accepted; no duplicate charge |
| M3 | P0 | payment-api down while PG retries; PG gives up; after restart reconcile and daily match find it |
| M4 | P0 | payment-api `paid`, pos-api down for 10 min: outbox keeps retrying; on recovery one completion; pos-api job also settles by polling |
| M5 | P0 | Paid after expiry and after cancel: payment status stays terminal, money becomes an unmatched receipt shown in the owner's "Perlu ditinjau" list, auto refund once, sale stays cancelled, stock not re-taken, cashier banner shows it |
| M6 | P1 auto-ui | Browser closed while waiting; reopen: pending list shows state; completed sale printable from history |
| M7 | P0 | Event orders: paid,expired / expired,paid / expired,paid,expired / paid,paid: final state per rank; paid wins over expired |
| M8 | P0 | Amount less/more by Rp1: not paid, `needs_review`, refunded; decimal or string amount rejected |
| M9 | P0 | Forged webhook: wrong signature 401; right signature but PG status call says unpaid: no paid; right signature, replayed old event: harmless |
| M10 | P0 | Unknown reference: stored, 200, flagged, never deleted; reconcile later pairs it if the payment appears |
| M11 | P0 | PG down at Bayar: `failed`, sale cancelled, stock and quota restored in one transaction, cashier can choose another method immediately |
| M12 | P0 | CASHAC paid, pos-api fails before completion: cashier retry with same key completes. After 10 min with no retry: expected behaviour per finding M15 (complete, not void) once agreed |
| M13 | P1 | Store erasure while pending or refunding: refused with reason; allowed after resolution (see M19 for stuck case) |
| V1 | P0 | Void twice (same key, different key): second returns first / is refused; stock and quota restored once |
| V2 | P0 | Cancel during pending is not a void: no PIN, no void row |
| V3 | P0 | Refund accepted by PG but funds pending: payment `refund_pending`, sale cancelled, stock restored once; later `refunded` event moves state, no second reversal |
| V4 | P0 | PG refuses refund: `refund_failed + needs_review`; owner retry works; "dikembalikan manual" requires a note; both audited |
| V5 | P0 | Void on a PG payment and refund on CASHAC rejected with clear message; fake PG call counter for void on CASHAC = 0 |
| V6 | P0 | Void of closed-shift receipt: old shift identical (hash of its report), cash-out in open shift; none open: rejected |
| V7 | P0 | Void partly-paid kasbon (Rp6.000, paid Rp2.500): receivable 0, Rp2.500 returned, one transaction; two concurrent instalment + void: serialised, no lost update |
| Reasons | P1 | Six reason codes stored as fixed codes; "Lainnya" requires a note; report counts per reason |

## C. Tests for proposed new codes

| Code | Pri | Test |
|---|---|---|
| D11 | P0 | Order has active payment A; fake PG reports a second paid payment B and a late paid on expired C: both stored as unmatched-receipt rows (outside the unique index), no unique violation, `settle` returns success, refunds issued once each; statuses of A and C unchanged |
| D12 | P0 | QR validity 15 minutes (owner decision). Cancel the old QR at any minute (PG can close it, or `canCancel=false` per D13): a new attempt is allowed immediately with a new attempt number, PG reference and QR; the old key still returns the old payment; no wait for the 10-minute grace (grace applies only to the automatic cancel). Also: automatic path with nobody pressing: sale cancelled after expiry + grace. Money arriving on the old QR becomes an unmatched receipt and is auto-refunded once |
| D13 | P1 | Adapter `canCancel=false` (owner approved): screen says the QR stays valid until HH:MM; cashier may switch to cash immediately, old payment becomes `cancelled`; a later payment on the old QR becomes an unmatched receipt, auto-refunded exactly once, never counted twice in revenue or drawer |
| M14 | P0 | Create times out, lookups say not found: `failed` is only set after two lookups at least 1 minute apart. PG later reports money: payment status STAYS `failed` (no failed -> paid), an unmatched-receipt row appears and is auto-refunded once |
| M15 | P0 | CASHAC paid + completion failure: sale completes via job, drawer row once, cashier alert if never confirmed; no automatic void |
| M16 | P0 | Outbox order `expired` then `paid` and reverse, plus pos-api down in between: sale never completes after cancel; no oversell of the last unit (STK-009 style) |
| M17 | P0 | payment-api down 30 min: awaiting sales listed with age; shift close blocked with the sale numbers; manual cancel refused until payment-api returns; after return reconcile first |
| M18 | P1 | Fake PG reports gross 10.000 with fee 700 and net 9.300: treated as matched; gross differs by Rp1: mismatch |
| V8 | P1 | Refund accepted then refused: report shows customer-owed liability Rp X; marking manual refund clears it; revenue/profit not double reversed |
| V9 | P0 | System auto-refund has actor `system`, no PIN prompt, audited; a human refund without PIN is refused; the PIN approver must be any actor holding `sales.void` (checked by pos-api) |
| M19 | P1 | Failed refund older than 30 days (fake clock) no longer blocks store erasure (owner approved); younger than 30 days: purge answers 409 naming what blocks; pending payments always end via expiry so they never block forever |
| M20 | P1 | Poison event: parked after N attempts with alert; later events for the payment still processed; reconcile settles |
| M21 | P1 | Payment paid at 23:59:30 store time settled by PG at 00:01: no false mismatch within tolerance; paid here but absent at PG: high-severity alert, no auto-refund |
| M22 | P1 | Kasbon sale creates a receivable, no paid payment; instalment by static QRIS has payment with order ref = receivable id; void of the sale handles both |
| Rank | P1 | Property test: random event sequences (reorder, duplicate, drop) never decrease rank and always end in one allowed final state; balance check holds |

| Rule5 | P1 | Only allowed backward move is `refund_failed -> refund_pending` (owner retry); every other transition that lowers rank is refused and logged |
