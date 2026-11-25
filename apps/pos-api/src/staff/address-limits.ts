import { isIPv4, isIPv6 } from 'node:net';

/**
 * What a per-address limit counts for a network address. An IPv4 address is one caller. An IPv6 caller is
 * handed a whole /64 (2^64 addresses) by its provider, so its first 64 bits are the caller: counting single
 * IPv6 addresses would limit nothing. An IPv4 address written as IPv6 (`::ffff:1.2.3.4`) is that IPv4
 * address. Anything that is no IP address is its own key.
 */
export function addressKey(address: string): string {
  const text = address.trim().toLowerCase().split('%')[0];
  if (isIPv4(text)) return text;
  if (!isIPv6(text)) return text;
  const groups = ipv6Groups(text);
  const isMapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMapped)
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]
      .map(String)
      .join('.');
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address. */
function ipv6Groups(text: string): number[] {
  const side = (part: string): number[] =>
    part === ''
      ? []
      : part.split(':').flatMap((piece) => {
          if (!piece.includes('.')) return [parseInt(piece, 16)];
          // A dotted IPv4 tail is two groups.
          const [a, b, c, d] = piece.split('.').map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const [head, tail] = text.split('::');
  const left = side(head);
  if (tail === undefined) return left;
  const right = side(tail);
  return [
    ...left,
    ...new Array<number>(8 - left.length - right.length).fill(0),
    ...right,
  ];
}

/**
 * A fixed-window limit per key, in memory: a limit per process, lost on restart. It exists to refuse a
 * flood before it reaches the database, not to be exact.
 *
 * The memory it takes is bounded: the whole map is dropped when the minute changes, and within one minute
 * it holds at most `maxKeys` keys. Past that a key it has not seen is refused, so many addresses cannot grow
 * it without end.
 */
export class AddressRateLimiter {
  private minute = 0;
  private readonly hits = new Map<string, number>();

  constructor(
    private readonly perMinute: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Counts one request of `key`; false when it is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const minute = Math.floor(now / 60_000);
    if (minute !== this.minute) {
      this.hits.clear();
      this.minute = minute;
    }
    const count = this.hits.get(key);
    if (count === undefined) {
      if (this.hits.size >= this.maxKeys) return false;
      this.hits.set(key, 1);
      return true;
    }
    if (count >= this.perMinute) return false;
    this.hits.set(key, count + 1);
    return true;
  }

  get size(): number {
    return this.hits.size;
  }
}
