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
});
