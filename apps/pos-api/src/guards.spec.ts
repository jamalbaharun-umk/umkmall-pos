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

  it('never calls payment-api inside a database transaction (payment-sync: one transaction, with no client call in it)', () => {
    const text = files.find(
      ({ f }) => f === path.join('payments-client', 'payment-sync.service.ts'),
    )!.text;
    const parts = text.split('.transaction(');
    expect(parts).toHaveLength(2);
    // The transaction's body: up to the end of applyToSale.
    const body = parts[1].slice(0, parts[1].indexOf('\n  }\n'));
    expect(body.length).toBeGreaterThan(300);
    expect(body).not.toMatch(/this\.client\./);
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
      path.join('shifts', 'shifts.service.ts'),
      path.join('sales', 'sales.service.ts'),
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
      path.join('payments-client', 'payment-sync.service.ts'),
      path.join('reports', 'reports.service.ts'),
      path.join('sales', 'sales.service.ts'),
      path.join('shifts', 'shifts.service.ts'),
      path.join('void', 'void.service.ts'),
    ]);
  });
});
