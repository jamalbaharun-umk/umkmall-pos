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
});
