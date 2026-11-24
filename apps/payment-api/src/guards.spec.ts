import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Source guards: rules a green e2e suite would not catch (CLAUDE.md, payment-api section).
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

const offenders = (pattern: RegExp, allowed: string[] = []) =>
  files
    .filter(({ f }) => !allowed.includes(f))
    .filter(({ text }) => pattern.test(text))
    .map(({ f }) => f);

describe('payment-api source guards', () => {
  it('sees the source tree', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it('never uses console (log through Nest Logger, without keys or references)', () => {
    expect(offenders(/\bconsole\.\w+\(/)).toEqual([]);
  });

  it('never reads a tenant id from the request body, query or params', () => {
    expect(
      offenders(/(body|query|params|input)\s*(\.|\[['"])\s*tenant_?[iI]d/),
    ).toEqual([]);
    expect(offenders(/@(Body|Query|Param)\(\s*['"]tenant_?[iI]d['"]/)).toEqual(
      [],
    );
  });

  it('reads the service key and the tenant header only in auth/service.guard.ts', () => {
    const guard = path.join('auth', 'service.guard.ts');
    expect(
      offenders(/['"]x-(payment-service-key|tenant-id)['"]/i, [guard]),
    ).toEqual([]);
    expect(offenders(/\.PAYMENT_SERVICE_KEY\b/, [guard])).toEqual([]);
  });

  // No PG adapter before the legal gate (UMK-1977): until one ships under src/adapters/, nothing in the
  // service may call out of the process. The first PG adapter narrows this guard to "only src/adapters/".
  it('never calls out of the process', () => {
    expect(
      offenders(
        /\bfetch\(|from ['"](node:)?(https?|http2|net|tls|dgram)['"]|\b(axios|undici)\b/,
      ),
    ).toEqual([]);
  });

  it('never handles money as a float', () => {
    expect(
      offenders(/\b(toFixed|parseFloat)\(|\b(numeric|decimal|real)\(/),
    ).toEqual([]);
  });
});
