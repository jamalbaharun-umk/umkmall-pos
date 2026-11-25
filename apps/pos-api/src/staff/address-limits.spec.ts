import { addressKey, AddressRateLimiter } from './address-limits';

describe('addressKey', () => {
  it('keeps an IPv4 address, also when it is written as IPv6', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(addressKey('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys an IPv6 address by its /64, however it is written', () => {
    const key = '2001:db8:1:2::/64';
    for (const address of [
      '2001:db8:1:2::1',
      '2001:DB8:1:2:ffff:ffff:ffff:ffff',
      '2001:0db8:0001:0002:0000:0000:0000:0001',
      '2001:db8:1:2:a:b:c:d%eth0',
      '2001:db8:1:2::203.0.113.7',
    ])
      expect(addressKey(address)).toBe(key);
    expect(addressKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('fe80::1:2:3:4')).toBe('fe80:0:0:0::/64');
  });

  it('leaves what is no IP address as it is', () => {
    expect(addressKey('unknown')).toBe('unknown');
    expect(addressKey('')).toBe('');
  });
});

describe('AddressRateLimiter', () => {
  const MINUTE = 60_000;

  it('allows a key its limit per minute, each key on its own, and starts again with the next minute', () => {
    const limiter = new AddressRateLimiter(3);
    const t = 10 * MINUTE;
    expect([1, 2, 3, 4].map(() => limiter.allow('a', t))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(limiter.allow('b', t + 59_999)).toBe(true);
    expect(limiter.allow('a', t + 59_999)).toBe(false);
    expect(limiter.allow('a', t + MINUTE)).toBe(true);
  });

  it('is bounded: nothing of a past minute is kept, and past its size a new key is refused', () => {
    const limiter = new AddressRateLimiter(3, 100);
    const t = 10 * MINUTE;
    for (let i = 0; i < 100; i++) expect(limiter.allow(`k${i}`, t)).toBe(true);
    expect(limiter.size).toBe(100);
    // A key it has not seen is refused; one it has seen still counts normally.
    expect(limiter.allow('new', t)).toBe(false);
    expect(limiter.allow('k0', t)).toBe(true);
    expect(limiter.size).toBe(100);
    // The next minute starts empty.
    expect(limiter.allow('new', t + MINUTE)).toBe(true);
    expect(limiter.size).toBe(1);
  });
});
