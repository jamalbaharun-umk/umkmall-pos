import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hashPin, verifyPin } from './secrets';

describe('staff secrets', () => {
  it('hashes a PIN with a salt and verifies only the right PIN', async () => {
    const [a, b] = await Promise.all([hashPin('1234'), hashPin('1234')]);
    expect(a).not.toBe(b);
    expect(a).not.toContain('1234');
    expect(await verifyPin('1234', a)).toBe(true);
    expect(await verifyPin('1235', a)).toBe(false);
    expect(await verifyPin('1234', 'garbage')).toBe(false);
  });

  it('never logs in the staff module (PINs, device secrets and names stay out of logs)', () => {
    const offenders = readdirSync(__dirname)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) =>
        /\b(Logger|logger)\b/.test(
          readFileSync(path.join(__dirname, f), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
