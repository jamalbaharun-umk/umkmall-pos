# Test cases: PG payment confirmation (webhook listener + manual status check) and double/missed payment

Scope: `apps/payment-api` (gateway-agnostic) and the two-step sale in pos-api (pending sale -> charge -> complete).
Written from the owner rules before the payment scheme was received; **re-review against the scheme when the
payment thread sends it** and fix names (marked *(assumed)*). A PG is simulated by a local fake gateway adapter that can
be scripted: delay, drop, duplicate, reorder, fail, and sign webhooks. No real PG is needed for local tests.

Core invariants (every case must keep them):
1. **No double payment:** one receipt reaches `paid` once; one charge per idempotency key; stock, voucher quota and
   drawer/ledger move once.
2. **No missed payment:** money received at the PG always ends as a completed receipt or an explicit refund; nothing
   stays "pending" forever.
3. payment-api is the source of truth for payment status; pos-api never marks paid without it.
4. All amounts integer rupiah; the paid amount must equal the sale total exactly.
5. Webhooks are authenticated, idempotent and safe to replay in any order.

Priority P0 = must pass before UMK-1975 sign-off. All `[auto-api]` unless marked.

## A. Webhook listener

| ID | Pri | Case | Expected |
|---|---|---|---|
| PGW-001 | P0 | Valid signed "paid" webhook for a pending charge | Charge -> paid; pos-api completes sale once; stock/ledger once |
| PGW-002 | P0 | Same webhook delivered 2, 5, 50 times (PG retry) | Still one completion; later calls answer 200 (so PG stops retrying) with no side effect |
| PGW-003 | P0 | Two identical webhooks delivered concurrently (race) | Exactly one state transition (row lock / unique event id); no double ledger row |
| PGW-004 | P0 | Invalid/missing/wrong signature, wrong secret, altered body | 401/403; nothing changes; no body echoed; attempt logged without secrets |
| PGW-005 | P0 | Replay of an old valid webhook (timestamp outside tolerance, if the PG signs timestamps) | Rejected or harmless no-op |
| PGW-006 | P0 | Out of order: "expired"/"failed" arrives after "paid" | Final state stays paid; late event recorded, ignored |
| PGW-007 | P0 | Out of order: "paid" arrives after "expired" | Defined rule: payment recorded and flagged for refund or revival; never lost silently (**open decision to confirm with payment thread**) |
| PGW-008 | P0 | "paid" arrives BEFORE pos-api finished creating the pending sale / charge record | Event stored and applied when the charge exists; not dropped |
| PGW-009 | P0 | Webhook for unknown charge/order reference | 200 + stored as orphan for reconciliation; alert row; no crash |
| PGW-010 | P0 | Paid amount differs from charge (less, more, Rp1 off) | Not auto-completed; flagged "amount mismatch"; operator/refund path |
| PGW-011 | P0 | Different currency or malformed amount (decimal, string, negative) | 422/ignored safely; no float stored |
| PGW-012 | P0 | Webhook for tenant A's charge carrying tenant B's reference | Never applied to B; cross-tenant isolation |
| PGW-013 | P1 | Payload very large / invalid JSON / unknown event type | 4xx or 200 no-op; no 500; unknown types stored |
| PGW-014 | P0 | payment-api up but pos-api down when "paid" arrives | payment-api stores paid; pos-api completes the sale when back (callback retry or reconciliation) |
| PGW-015 | P0 | pos-api finalize fails midway (DB error after payment paid) | Transaction rolled back as a whole; sale stays pending; retry completes once; never "paid but no stock move" |
| PGW-016 | P1 | Webhook endpoint under load (200 events/s mixed duplicates) | No duplicates, no deadlock, p95 within limit |
| PGW-017 | P1 | Webhook secret rotation | Old secret accepted only during overlap window |

## B. Manual status check (cashier presses "Cek status" / polling)

| ID | Pri | Case | Expected |
|---|---|---|---|
| PGM-001 | P0 | Webhook never arrives; cashier checks status; PG says paid | payment-api pulls status from PG, marks paid, sale completes once |
| PGM-002 | P0 | Manual check while the webhook arrives at the same moment | One transition; both paths idempotent |
| PGM-003 | P0 | Manual check repeated rapidly (button mashing, 10 calls) | One PG call per rate-limit window; no duplicate completion; UI shows single state |
| PGM-004 | P0 | PG status endpoint times out / 5xx | Status stays "pending/unknown"; UI says "belum bisa dipastikan, coba lagi"; no failure assumed |
| PGM-005 | P0 | PG says pending | Remain pending; no new charge created |
| PGM-006 | P0 | PG says expired/failed/cancelled | Charge -> expired/failed; sale cancelled; stock and quota untouched; cashier may start a NEW charge (new key) |
| PGM-007 | P0 | Cashier retries "Bayar" after unclear result | Same idempotency key returns the same charge; never a second charge at the PG |
| PGM-008 | P0 | Cashier switches to another method (cash) while a PG charge is pending | Pending charge cancelled at PG first (or blocked until resolved); if PG later reports paid -> flagged for refund, never double-collected |
| PGM-009 | P0 | Customer pays after the cashier already took cash for the same receipt | Detected as duplicate payment: PG money auto-refunded or queued for refund with alert; receipt counted once |
| PGM-010 | P1 | Manual check permission | Any cashier with sale permission may check; cannot mark paid manually |
| PGM-011 | P0 | "Mark as paid manually" (if offered) | Requires explicit permission + reason + audit; excluded for PG methods unless owner designed it (**confirm**) |

## C. Charge creation and idempotency

| ID | Pri | Case | Expected |
|---|---|---|---|
| PGC-001 | P0 | Create charge twice, same key, same body | One charge, same response |
| PGC-002 | P0 | Same key, different amount/order reference | 409/422; first charge unchanged |
| PGC-003 | P0 | Key reused across two tenants | Independent |
| PGC-004 | P0 | PG call succeeded but response lost (timeout) -> retry | Retry finds the existing PG charge by reference; no second charge |
| PGC-005 | P0 | payment-api crashes after saving charge, before PG call | Reconciliation completes or cancels; never an orphan charge without owner |
| PGC-006 | P0 | payment-api crashes after PG call, before saving | Reconciliation lists PG charges missing locally and adopts them |
| PGC-007 | P0 | Charge amount Rp0, negative, decimal, over PG max, below PG min | 422 before any PG call |
| PGC-008 | P0 | Charge expires (e.g. 15 min) with no payment | Expired; sale cancelled; stock released; cashier sees expired state |
| PGC-009 | P0 | Customer pays at second 14:59 and 15:01 around the expiry boundary | Paid-before-expiry completes; paid-after-expiry follows PGW-007 rule |
| PGC-010 | P0 | Two cashiers charge the same receipt at once | One active charge per receipt |
| PGC-011 | P1 | Void/refund request during pending | Pending charge cancelled, not refunded; refund only after paid |

## D. Reconciliation job

| ID | Pri | Case | Expected |
|---|---|---|---|
| REC-001 | P0 | Sale pending older than N minutes, PG says paid | Completed once |
| REC-002 | P0 | Sale pending older than N minutes, PG says expired/unknown | Cancelled, stock released |
| REC-003 | P0 | PG shows a paid charge with no matching POS sale | Reported as orphan; refund queue; alert; never silently ignored |
| REC-004 | P0 | Paid charge whose sale was cancelled/voided in POS | Refund created exactly once |
| REC-005 | P0 | Job runs twice concurrently (two instances) | Locking prevents double processing |
| REC-006 | P0 | Job interrupted mid-run, then restarted | Resumes; no duplicates |
| REC-007 | P0 | Daily total: sum of payment-api paid charges == sum of completed PG receipts in pos-api for the store day | Zero difference, or every difference listed |
| REC-008 | P1 | PG settlement/report file vs payment-api (if provided) | Differences listed per charge |
| REC-009 | P1 | Clock skew between services 5 min | Expiry/reconciliation windows still safe |
| REC-010 | P1 | Reconciliation runs during peak (many pending) | Bounded batch size; no PG rate-limit breach |

## E. Refund of PG payments (contract-level; QRIS PG itself is M5)

| ID | Pri | Case | Expected |
|---|---|---|---|
| RFD-001 | P0 | Refund a paid PG receipt, full amount, with admin PIN | PG refund once; sale reversal row; stock back; status refunded |
| RFD-002 | P0 | Refund retry after timeout | Same key, one refund at PG |
| RFD-003 | P0 | Partial refund attempt | Rejected (full only) |
| RFD-004 | P0 | Refund an unpaid/pending/expired charge | Rejected with clear message |
| RFD-005 | P0 | Refund a refunded charge | Rejected, no second refund |
| RFD-006 | P0 | PG refuses refund (insufficient settlement balance, window passed) | Receipt not voided; clear error; stays paid |
| RFD-007 | P0 | Refund confirmed by webhook later than the API response | One state transition, no double reversal |
| RFD-008 | P0 | Refund and a late "paid" webhook race | Defined, single outcome |
| RFD-009 | P0 | Voiding a CASHAC receipt must never call the PG | Verified with fake PG call counter = 0 |
| RFD-010 | P0 | Refund in a closed shift receipt | Drawer unaffected (money returned by PG, not from drawer) — confirm with owner since cash-out rule applies to cash |

## F. Cashier-facing states (UI)

| ID | Pri | Type | Case | Expected |
|---|---|---|---|---|
| PGU-001 | P0 | auto-ui | Pending | "Menunggu pembayaran", Bayar locked, no double tap |
| PGU-002 | P0 | auto-ui | Failed | Message states no payment and no stock change; options Coba lagi / Pilih cara lain |
| PGU-003 | P0 | auto-ui | Network drop on the phone while pending | State recovered from history; no duplicate receipt on reload |
| PGU-004 | P0 | auto-ui | Browser tab closed while pending, reopened | Receipt resumes from server state |
| PGU-005 | P1 | auto-ui | Paid arrives while screen is open | Auto-advances to success without a manual press |
| PGU-006 | P1 | manual | Two devices open on the same pending receipt | Both show the same state |

## G. Security and observability

| ID | Pri | Case | Expected |
|---|---|---|---|
| PGS-001 | P0 | Webhook/PG credentials never in logs, responses or the repo | grep clean |
| PGS-002 | P0 | Internal payment-api endpoints callable only by pos-api (service auth) | Others 401 |
| PGS-003 | P0 | payment-api DB isolated; store erasure removes its rows | Covered by purge test (TBD) |
| PGS-004 | P1 | Every state change has an audit row (who/what/when, event id) | Present |
| PGS-005 | P1 | Metrics/alerts for: pending > N min, orphan charges, amount mismatch, webhook failures | Visible (log or table) |

## H. Fake-gateway test harness (proposed)

Local script `apps/payment-api/test/support/fake-gateway.ts` *(proposed)* with knobs: `latencyMs`, `dropResponse`,
`failNext`, `duplicateWebhook(n)`, `reorder([...events])`, `signWith(secret)`, `expireAt(ts)`, `statusOverride`. Each
case above maps to a scripted run; no real PG account is needed.

## I. Open questions for the payment thread

1. PGW-007 and PGC-009: payment arriving after expiry: revive the receipt, or auto-refund?
2. PGM-011: is manual "mark paid" allowed for PG methods at all?
3. PGM-008: switch to cash while a charge is pending: cancel first, or block?
4. RFD-010: refund of a PG receipt from a closed shift: confirm the drawer is untouched.
5. REC window N and charge expiry values.
6. Webhook retry policy of the target PG and signature scheme (timestamp tolerance).
