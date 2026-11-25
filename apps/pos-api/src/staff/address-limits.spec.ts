import {
  addressKey,
  AddressRateLimiter,
  COARSE_FACTOR,
  coarseAddressKey,
  SHARED_FACTOR,
} from './address-limits';

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

  it('a full map does not shut out a new address: it is counted by its wider network instead', () => {
    const limiter = new AddressRateLimiter(3, 100);
    const t = 10 * MINUTE;
    // One caller with an IPv6 /48 fills the map with a hundred /64s of it.
    const flood = (i: number) =>
      addressKey(`2001:db8:f00d:${i.toString(16)}::1`);
    for (let i = 0; i < 100; i++) expect(limiter.allow(flood(i), t)).toBe(true);
    // A shop it has nothing to do with still gets its requests, IPv4 or IPv6, up to its own limit.
    expect(limiter.allow(addressKey('203.0.113.7'), t)).toBe(true);
    expect(limiter.allow(addressKey('2001:db8:beef:1::9'), t)).toBe(true);
    for (let i = 1; i < 3 * COARSE_FACTOR; i++)
      expect(limiter.allow(addressKey('203.0.113.7'), t)).toBe(true);
    expect(limiter.allow(addressKey('203.0.113.7'), t)).toBe(false);
    // The flooder's further /64s are one network now, with one count: it runs out, the others do not.
    const more = Array.from({ length: 20 }, (_, i) =>
      limiter.allow(flood(1000 + i), t),
    );
    expect(more.filter(Boolean)).toHaveLength(3 * COARSE_FACTOR);
    expect(more.slice(3 * COARSE_FACTOR).every((ok) => !ok)).toBe(true);
    expect(limiter.allow(addressKey('198.51.100.20'), t)).toBe(true);
    // Addresses the map already holds keep their own exact count.
    expect(limiter.allow(flood(0), t)).toBe(true);
    expect(limiter.allow(flood(0), t)).toBe(true);
    expect(limiter.allow(flood(0), t)).toBe(false);
  });

  it('is bounded: both maps hold at most their size, past that one shared count, and a new minute starts empty', () => {
    const limiter = new AddressRateLimiter(3, 100);
    const t = 10 * MINUTE;
    // 100 exact keys, then 100 wider networks: nothing more is stored after that.
    for (let i = 0; i < 100; i++) expect(limiter.allow(`a${i}`, t)).toBe(true);
    for (let i = 0; i < 100; i++) expect(limiter.allow(`b${i}`, t)).toBe(true);
    expect(limiter.size).toBe(200);
    const rest = Array.from({ length: 3 * SHARED_FACTOR + 50 }, (_, i) =>
      limiter.allow(`c${i}`, t),
    );
    expect(limiter.size).toBe(200);
    expect(rest.filter(Boolean)).toHaveLength(3 * SHARED_FACTOR);
    expect(rest.slice(3 * SHARED_FACTOR).every((ok) => !ok)).toBe(true);
    // The next minute starts empty.
    expect(limiter.allow('c0', t + MINUTE)).toBe(true);
    expect(limiter.size).toBe(1);
  });
});

describe('coarseAddressKey', () => {
  it('widens an IPv6 /64 to its /48 and leaves an IPv4 address', () => {
    expect(coarseAddressKey(addressKey('2001:db8:f00d:12::1'))).toBe(
      '2001:db8:f00d::/48',
    );
    expect(coarseAddressKey(addressKey('::1'))).toBe('0:0:0::/48');
    expect(coarseAddressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(coarseAddressKey('unknown')).toBe('unknown');
  });
});
