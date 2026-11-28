import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Repo guards (the UMKMall monorepo's guard tests do not reach this repo, so it carries its own).
const SRC = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((f) => ({
  f: path.relative(SRC, f),
  text: readFileSync(f, 'utf8'),
}));

describe('repo guards', () => {
  it('sees the source tree', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('verifies or signs POS tokens only in tenancy/session.ts', () => {
    const offenders = files
      .filter(({ f }) => f !== path.join('tenancy', 'session.ts'))
      .filter(({ text }) => /\b(jwtVerify|SignJWT|jwtDecrypt)\b/.test(text))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('pins the routes a helper session can reach (@HelperRoute, UMK-2124): a new one is a reviewed change', () => {
    const reached: string[] = [];
    for (const { text } of files) {
      const re =
        /@Controller\('([^']*)'\)|@HelperRoute\(\)\s*(?:@\w+\([^)]*\)\s*)*?@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g;
      let prefix = '';
      for (const m of text.matchAll(re)) {
        if (m[1] !== undefined) prefix = m[1];
        else
          reached.push(
            `${m[2].toUpperCase()} /${[prefix, m[3]].filter(Boolean).join('/')}`,
          );
      }
    }
    // Design 42: the restricted till reads what it shows, sells, prints its own receipts, and hands back.
    expect(reached.sort()).toEqual(
      [
        'GET /catalog/products',
        'GET /catalog/products/:id/images/:imageId',
        'GET /payment-methods',
        'GET /sales/:id/receipt',
        'GET /sales/settings',
        'GET /shifts/current',
        'GET /store/profile',
        'GET /store/profile/logo',
        'GET /store/profile/qris',
        'GET /tenant/me',
        'POST /helper/end',
        'POST /sales',
        'POST /sales/quote',
      ].sort(),
    );
  });

  it("pins the routes UMKMall's agent session can reach (@AgentRoute): a new one is a reviewed change", () => {
    const reached: string[] = [];
    for (const { text } of files) {
      const re =
        /@Controller\('([^']*)'\)|@AgentRoute\(\)\s*(?:@\w+\([^)]*\)\s*)*?@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g;
      let prefix = '';
      for (const m of text.matchAll(re)) {
        if (m[1] !== undefined) prefix = m[1];
        else
          reached.push(
            `${m[2].toUpperCase()} /${[prefix, m[3]].filter(Boolean).join('/')}`,
          );
      }
    }
    expect(reached.sort()).toEqual(
      [
        'GET /agent/activity',
        'GET /agent/ledger',
        'GET /catalog/categories',
        'GET /catalog/products',
        'GET /catalog/products/:id',
        'GET /reports/dashboard',
        'GET /reports/products',
        'GET /reports/profit-loss',
        'GET /reports/purchasing',
        'GET /reports/sales',
        'GET /stock/products/:id',
        'GET /store/profile',
        'POST /catalog/categories',
        'POST /catalog/products',
        'POST /catalog/products/:id/images',
        'POST /mcp',
        // UMK-1981
        'GET /members/picker',
        'GET /payment-methods',
        'GET /receivables',
        'GET /receivables/:id',
        'GET /shifts/current',
        'GET /suppliers',
        'POST /members',
        'POST /receivables/:id/payments',
        'POST /sales',
        'POST /sales/quote',
        'POST /shifts/open',
        'POST /suppliers',
        // UMK-2070
        'POST /purchasing/orders/stock-in',
        // UMK-2127
        'GET /recipes/breakdown',
        'GET /recipes/:id',
        'POST /recipes',
      ].sort(),
    );
  });

  it('never uses console (log through Nest Logger without tokens or PII)', () => {
    const offenders = files
      .filter(({ text }) => /\bconsole\.\w+\(/.test(text))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('never reads a tenant id from the request body, query or params', () => {
    const offenders = files
      .filter(({ text }) =>
        /(body|query|params)\s*(\.|\[['"])\s*tenant_?[iI]d/.test(text),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('writes the shift cash ledger only in shifts/cash-ledger.ts (under the open shift lock)', () => {
    const offenders = files
      .filter(({ f }) => f !== path.join('shifts', 'cash-ledger.ts'))
      .filter(({ text }) =>
        /\.(insert|update|delete)\(\s*shiftCashEntries\b|(insert\s+into|update|delete\s+from)\s+pos\.shift_cash_entries/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('writes the store cash ledger only in store-cash/store-cash-ledger.ts', () => {
    const offenders = files
      .filter(({ f }) => f !== path.join('store-cash', 'store-cash-ledger.ts'))
      .filter(({ text }) =>
        /\.(insert|update|delete)\(\s*storeCashEntries\b|(insert\s+into|update|delete\s+from)\s+pos\.store_cash_entries/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('writes pos.expenses and the expense kinds of the shift ledger only in expenses/expenses.service.ts', () => {
    const offenders = files
      .filter(({ f }) => f !== path.join('expenses', 'expenses.service.ts'))
      .filter(({ text }) =>
        /\.(insert|update|delete)\(\s*(expenses|expenseEdits)\b|(insert\s+into|update|delete\s+from)\s+pos\.expense(s|_edits)\b|kind:\s*['"`]expense(_reversal)?['"`]/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    // And the service itself goes through the ledger's functions, under the shift's row lock.
    const service = files.find(
      ({ f }) => f === path.join('expenses', 'expenses.service.ts'),
    )!.text;
    expect(service).toMatch(/recordShiftCash\(/);
    expect(service).toMatch(/recordShiftCashInShift\(/);
    // The edit history is append-only: inserted, never changed.
    expect(service).toMatch(/\.insert\(expenseEdits\)/);
    expect(service).not.toMatch(/\.(update|delete)\(\s*expenseEdits\b/);
  });

  it('writes supplier payments, purchase returns, their reversals, supplier refunds and their ledger kinds only in purchasing/purchase-payments.service.ts (UMK-1970)', () => {
    const own = path.join('purchasing', 'purchase-payments.service.ts');
    const offenders = files
      .filter(({ f }) => f !== own)
      .filter(({ text }) =>
        /\.(insert|update|delete)\(\s*(purchasePayments|purchaseReturns|purchaseReturnLines|purchaseReturnReversals|purchaseRefunds)\b|(insert\s+into|update|delete\s+from)\s+pos\.purchase_(payments|returns|return_lines|return_reversals|refunds)\b|kind:\s*['"`]purchase_(payment|refund)(_reversal|_void)?['"`]/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    const service = files.find(({ f }) => f === own)!.text;
    // Through the ledgers' own writers (the shift's row lock, the agent allow-list) and the stock service.
    expect(service).toMatch(/recordShiftCash\(/);
    expect(service).toMatch(/recordShiftCashInShift\(/);
    expect(service).toMatch(/this\.stock\.returnToSupplier\(/);
    expect(service).toMatch(/this\.stock\.undoReturnToSupplier\(/);
    // Returns and their reversals are append-only; a payment or a refund changes only by its void (an update of
    // the voided_* columns).
    expect(service).not.toMatch(
      /\.(update|delete)\(\s*(purchaseReturns|purchaseReturnLines|purchaseReturnReversals)\b/,
    );
    expect(service).not.toMatch(
      /\.delete\(\s*(purchasePayments|purchaseRefunds)\b/,
    );
    expect(service.match(/\.update\(\s*purchasePayments\b/g)).toHaveLength(1);
    expect(service.match(/\.update\(\s*purchaseRefunds\b/g)).toHaveLength(1);
  });

  it('writes pos.manual_cash_entries and the manual kinds of the shift ledger only in shifts/cash-entries.service.ts', () => {
    const own = path.join('shifts', 'cash-entries.service.ts');
    const offenders = files
      .filter(({ f }) => f !== own)
      .filter(({ text }) =>
        /\.(insert|update|delete)\(\s*manualCashEntries\b|(insert\s+into|update|delete\s+from)\s+pos\.manual_cash_entries\b|kind:[^,;\n]*['"`]manual_(in|out)['"`]/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    // The service goes through the ledger (the shift's row lock, the agent allow-list), and its rows are
    // append-only.
    const service = files.find(({ f }) => f === own)!.text;
    expect(service).toMatch(/recordShiftCashAt\(/);
    expect(service).toMatch(/assertPersonAtTill\(s\.kind\)/);
    expect(service).toMatch(/\.insert\(manualCashEntries\)/);
    expect(service).not.toMatch(/\.(update|delete)\(\s*manualCashEntries\b/);
  });

  it('refuses a drawer cash-out for a session kind off the allow-list in every writer of the shift ledger', () => {
    const ledger = files.find(
      ({ f }) => f === path.join('shifts', 'cash-ledger.ts'),
    )!.text;
    // The allow-list names people at the till only: never an agent.
    const list = /DRAWER_CASH_OUT_ACTOR_KINDS[^=]*=\s*\[([^\]]*)\]/.exec(
      ledger,
    );
    expect(list).not.toBeNull();
    expect(list![1].replace(/[\s'",]+/g, ' ').trim()).toBe('owner cashier');
    // Every function that reaches the insert checks the session kind first.
    const writers = ledger.split(/\nexport async function /).slice(1);
    const inserting = writers.filter((w) => /await insertEntry\(/.test(w));
    expect(inserting.length).toBe(3);
    for (const w of inserting)
      expect(
        w.indexOf('assertMayMoveDrawerCash(s.kind, entry.direction)'),
      ).toBeGreaterThan(-1);
    for (const w of inserting)
      expect(w.indexOf('assertMayMoveDrawerCash(')).toBeLessThan(
        w.indexOf('await '),
      );
  });

  it('lets only a person at the till act on a sale’s PG payment: every action route checks the session kind first (UMK-1991)', () => {
    // The switch to cash puts cash in a drawer; an agent session moves no payment and asks no refund.
    const text = (f: string) => files.find((x) => x.f === f)!.text;
    const actions = text(
      path.join('payments-client', 'sale-payment.controller.ts'),
    )
      .split(/\n {2}@Post\(/)
      .slice(1);
    expect(actions.length).toBe(4);
    const refunds = text(path.join('void', 'void.controller.ts'))
      .split(/\n {2}@Post\(/)
      .slice(1)
      .filter((route) => route.startsWith("':id/refund"));
    expect(refunds.length).toBe(3);
    for (const route of [...actions, ...refunds]) {
      const check = route.indexOf('assertPersonAtTill(s.kind);');
      expect(check).toBeGreaterThan(-1);
      // Before the route does anything else.
      expect(check).toBeLessThan(route.indexOf('this.'));
    }
  });

  it('writes pos.store_cash_deposits and the kind collector_deposit (store and shift ledger) only in store-cash/store-cash-deposits.service.ts', () => {
    const own = path.join('store-cash', 'store-cash-deposits.service.ts');
    const offenders = files
      .filter(({ f }) => f !== own)
      .filter(({ text }) =>
        /\.(insert|update|delete)\(\s*storeCashDeposits\b|(insert\s+into|update|delete\s+from)\s+pos\.store_cash_deposits\b|kind:\s*['"`]collector_deposit['"`]/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    const service = files.find(({ f }) => f === own)!.text;
    // Through each ledger's one writer, under the collector's row lock, append-only. The cash enters a
    // drawer (shift ledger) and leaves the store's cash (an `out`, never a `transfer`): counted once.
    expect(service).toMatch(/recordStoreCash\(/);
    expect(service).toMatch(/recordShiftCashAt\(/);
    expect(service).toMatch(/assertPersonAtTill\(s\.kind\)/);
    expect(service).not.toMatch(/direction:\s*['"`]transfer['"`]/);
    expect(service).toMatch(/\.for\('update'\)/);
    expect(service).toMatch(/\.insert\(storeCashDeposits\)/);
    expect(service).not.toMatch(/\.(update|delete)\(\s*storeCashDeposits\b/);
  });

  it('writes the kinds receivable_reversal(_closed_shift) only in receivables/receivable-corrections.service.ts, and the book stays append-only (UMK-1971)', () => {
    const own = path.join('receivables', 'receivable-corrections.service.ts');
    const offenders = files
      .filter(({ f }) => f !== own)
      .filter(({ text }) => {
        const code = text.replace(/^\s*\/\/.*$/gm, '');
        return (
          /direction:\s*['"`](in|out)['"`],\s*kind:\s*['"`]receivable_reversal['"`]/.test(
            code,
          ) || /kind:\s*['"`]receivable_reversal_closed_shift['"`]/.test(code)
        );
      })
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    const service = files.find(({ f }) => f === own)!.text;
    // A person at the till, under the receivable's row lock, through the ledgers' own writers.
    expect(service).toMatch(/assertPersonAtTill\(s\.kind\)/);
    expect(service).toMatch(/\.for\('update'\)/);
    expect(service).toMatch(/recordShiftCashInShift\(/);
    expect(service).toMatch(/recordStoreCash\(/);
    // A payment row is never changed or deleted by pos-api's own code: only payment-sync stamps payment-api's
    // answer on it (`payment_id`, `payment_sync_pending`).
    const changers = files
      .filter(
        ({ f }) =>
          f !== path.join('payments-client', 'payment-sync.service.ts'),
      )
      .filter(({ text }) =>
        /\.(update|delete)\(\s*(receivablePayments|rp)\b|(update|delete\s+from)\s+pos\.receivable_payments\b/i.test(
          text,
        ),
      )
      .map(({ f }) => f);
    expect(changers).toEqual([]);
  });

  it('touches the void PIN table only in void/void-pin.ts (the hash never reaches a response or a log)', () => {
    const offenders = files
      .filter(
        ({ f }) =>
          f !== path.join('void', 'void-pin.ts') &&
          f !== path.join('db', 'schema', 'voids.ts'),
      )
      .filter(({ text }) => /\bvoidPins\b|\bvoid_pins\b/.test(text))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('filters every write of a void by tenant (void/, cancelReceivable, restoreSale): no `.where(eq(x.id, …))` alone', () => {
    const text = (f: string) => files.find((x) => x.f === f)!.text;
    const slice = (f: string, from: string, to: string) => {
      const t = text(f);
      const i = t.indexOf(from);
      expect(i).toBeGreaterThan(-1);
      return t.slice(i, t.indexOf(to, i + from.length));
    };
    const parts: Record<string, string> = {
      'void/void.service.ts': text(path.join('void', 'void.service.ts')),
      'void/void-pin.ts': text(path.join('void', 'void-pin.ts')),
      cancelReceivable: slice(
        path.join('receivables', 'receivables.controller.ts'),
        'export async function cancelReceivable',
        '\n}\n',
      ),
      restoreSale: slice(
        path.join('stock', 'stock.service.ts'),
        'async restoreSale(',
        '\n  }\n',
      ),
    };
    for (const part of Object.values(parts))
      expect(part.length).toBeGreaterThan(200);
    // A where clause whose whole condition is one `eq(table.id, …)` has no tenant filter.
    const offenders = Object.entries(parts)
      .filter(([, t]) => /\.where\(\s*eq\(\s*(?!tenants\.)\w+\.id\s*,/.test(t))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it('reads the payment-api service key and writes its key and tenant headers only in payments-client/payments.client.ts', () => {
    const allowed = [
      path.join('payments-client', 'payments.client.ts'),
      'config.ts', // the env schema names the variable; it never sends it
    ];
    const offenders = files
      .filter(({ f }) => !allowed.includes(f))
      .filter(({ text }) =>
        /PAYMENT_SERVICE_KEY|x-payment-service-key|x-tenant-id/i.test(text),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    // And the client never logs them: its only log lines are the route pattern and a status or error class.
    const client = files.find(({ f }) => f === allowed[0])!.text;
    expect(client).toContain("'X-Tenant-Id': tenantId");
    expect(
      [...client.matchAll(/this\.logger\.\w+\(([^;]*)\);/g)].filter((m) =>
        /serviceKey|headers|tenantId|path\b|body/.test(m[1]),
      ),
    ).toEqual([]);
  });

  it('never calls payment-api inside a database transaction (payments-client: no client call in any transaction)', () => {
    const inClient = (name: string) =>
      files.find(({ f }) => f === path.join('payments-client', name))!.text;
    const text = inClient('payment-sync.service.ts');
    // Every transaction of the file is written `this.db.transaction(async (tx) => { … \n    });`: the
    // write of a sale's step 2, the request of a switch to cash, the turn of a sale into a cash sale, the
    // request of a new bill and the move of a sale to its next attempt (UMK-2042).
    const bodies = text
      .split('.transaction(')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf('\n    });\n')));
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect(body.length).toBeGreaterThan(300);
      // Neither the client nor anything of this class that calls it.
      expect(body).not.toMatch(
        /this\.client\b|this\.(settle|closeBill|syncVoid|recordKasbon|\w*Refund)\w*\(/,
      );
    }
    // The cashier's routes (status, cash, cancel) open no transaction at all: they only call PaymentSync.
    for (const name of [
      'sale-payment.service.ts',
      'sale-payment.controller.ts',
    ])
      expect(inClient(name)).not.toMatch(/\.transaction\(|\.for\('update'\)/);
    // Sales, receivables and void call payment-api only through PaymentSync, after their own commit.
    const direct = files
      .filter(
        ({ f }) => !f.startsWith('payments-client') && !f.startsWith('purge'),
      )
      .filter(({ text: t }) => /\bPaymentsClient\b/.test(t))
      .map(({ f }) => f);
    expect(direct).toEqual([]);
  });

  it('counts only receipts: every aggregate over pos.sales filters FINAL_SALE_STATUSES, never its own list', () => {
    for (const f of [
      path.join('reports', 'reports.service.ts'),
      path.join('reports', 'receivables-report.service.ts'),
      path.join('shifts', 'shifts.service.ts'),
      path.join('sales', 'sales.service.ts'),
      path.join('agent', 'ledger.controller.ts'),
      // Activation metrics (UMK-2131): first sale and sales days, receipts only (`FINAL_SALE_STATUSES`).
      path.join('onboarding', 'activation.ts'),
      path.join('summaries', 'summaries.service.ts'),
      path.join('reports', 'export', 'trend.service.ts'),
      path.join('reports', 'export', 'visuals.service.ts'),
    ]) {
      const text = files.find((x) => x.f === f)!.text;
      expect(text).toContain('FINAL_SALE_STATUSES');
      expect(text).not.toMatch(/'completed',\s*'void'/);
    }
    // And no other file reads pos.sales in bulk without knowing the statuses.
    const readers = files
      .filter(({ text }) => /\.from\(sales\)|\bpos\.sales\b/.test(text))
      .filter(({ f }) => !f.startsWith(path.join('db', 'schema')))
      .map(({ f }) => f)
      .sort();
    expect(readers).toEqual([
      // The ledger feed: receipts only (`status in FINAL_SALE_STATUSES`).
      path.join('agent', 'ledger.controller.ts'),
      // Activation metrics (UMK-2131): receipts only.
      path.join('onboarding', 'activation.ts'),
      // Sales by id of any status (the sale a late payment came in for) and refused refunds, for the owner.
      path.join('payments-client', 'payment-review.service.ts'),
      path.join('payments-client', 'payment-sync.service.ts'),
      // One sale by id, of any status: the payment screen of a sale that still waits.
      path.join('payments-client', 'sale-payment.service.ts'),
      // The dashboard widgets (UMK-1972): every aggregate filters `status in FINAL_SALE_STATUSES`.
      path.join('reports', 'dashboard-widgets.service.ts'),
      // The report charts and the sales and expenses trend: receipts only (`FINAL_LIST` from FINAL_SALE_STATUSES).
      path.join('reports', 'export', 'trend.service.ts'),
      path.join('reports', 'export', 'visuals.service.ts'),
      // The kasbon report (UMK-1964): each open kasbon's sale number, joined by id, receipts only.
      path.join('reports', 'receivables-report.service.ts'),
      path.join('reports', 'reports.service.ts'),
      path.join('sales', 'sales.service.ts'),
      path.join('shifts', 'shifts.service.ts'),
      // The summaries above each menu (feature 39): receipts only, by status.
      path.join('summaries', 'summaries.service.ts'),
      path.join('void', 'void.service.ts'),
    ]);
  });
});
