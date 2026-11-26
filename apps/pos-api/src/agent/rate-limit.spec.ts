import { WindowLimiter } from './rate-limit';

describe('WindowLimiter', () => {
  it('allows `limit` hits per window per key, then refuses until the window turns', () => {
    const l = new WindowLimiter(2, 1000);
    expect([l.hit('a', 0), l.hit('a', 10), l.hit('a', 20)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(l.hit('b', 20)).toBe(true);
    expect(l.hit('a', 1000)).toBe(true);
  });

  it('stays bounded in memory', () => {
    const l = new WindowLimiter(1, 1000, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(l.hit(k, 0)).toBe(true);
    expect(
      (l as unknown as { windows: Map<string, unknown> }).windows.size,
    ).toBeLessThanOrEqual(3);
  });
});
