# POS M1 test plan (drives local E2E, Linear UMK-1975)

Everything runs locally; no deploy. Start with `00-local-setup.md`.

| File | Content |
|---|---|
| `00-local-setup.md` | Local setup: Postgres, env, own PGTEST_DB, dev sign-in, seeding, troubleshooting |
| `01-payments-money.md` | PAY-001..147: totals/tax, wholesale math, cash, static QRIS, void + PIN, closed-shift void, kasbon, shift/drawer, expenses, reports; 3 reconciling day scenarios; gaps G-01..G-26 |
| `02-expenses-stock-pricing.md` | EXP, PNL, STK, UNT cases (designs 1-3) |
| `03-agent-permissions-tenancy-e2e.md` | AGT (MCP), PRM matrix, TEN, cross-cutting X, E2E-1..8 master scenarios, automated skeleton layout |
| `04-pg-confirmation-edge-cases.md` | Generic webhook/manual-check/reconcile/refund cases for payment-api |
| `05-payment-api-spec-review-and-cases.md` | QA review of the payment-api spec (all findings adopted, rev 17) and one test per spec code D1-D13, M1-M22, V1-V9 |

Priority P0 = must pass before UMK-1975 sign-off. Endpoints marked "(assumed)" must be re-checked when the engineer's routes land.
