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

/**
 * The wider network of an `addressKey`: the /48 of an IPv6 /64 (what one site is usually handed). An IPv4
 * address is its own.
 */
export function coarseAddressKey(key: string): string {
  const v6 = /^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):[0-9a-f]+::\/64$/.exec(key);
  return v6 ? `${v6[1]}::/48` : key;
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
 * The memory it takes is bounded: everything is dropped when the minute changes, and within one minute it
 * holds at most `maxKeys` keys. A caller who fills it (an IPv6 /48 has 65 536 /64s) must not thereby shut
 * out everyone else, so a key that no longer fits is NOT refused. It is counted more coarsely instead:
 * 1. by its wider network (`coarseAddressKey`), in a second map of the same size, with `COARSE_FACTOR` times
 *    the limit: the caller who filled the first map is one network here and uses up only its own count;
 * 2. and when that map is full too (a caller with far more than a /48), in one count all such keys share,
 *    with `SHARED_FACTOR` times the limit. Only then can a flood refuse an address it has nothing to do with,
 *    and only until the minute changes.
 */
export const COARSE_FACTOR = 4;
export const SHARED_FACTOR = 100;

export class AddressRateLimiter {
  private minute = 0;
  private readonly hits = new Map<string, number>();
  private readonly coarseHits = new Map<string, number>();
  private sharedHits = 0;

  constructor(
    private readonly perMinute: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Counts one request of `key`; false when it is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const minute = Math.floor(now / 60_000);
    if (minute !== this.minute) {
      this.hits.clear();
      this.coarseHits.clear();
      this.sharedHits = 0;
      this.minute = minute;
    }
    if (this.hits.has(key) || this.hits.size < this.maxKeys)
      return count(this.hits, key, this.perMinute);
    const coarse = coarseAddressKey(key);
    if (this.coarseHits.has(coarse) || this.coarseHits.size < this.maxKeys)
      return count(this.coarseHits, coarse, this.perMinute * COARSE_FACTOR);
    if (this.sharedHits >= this.perMinute * SHARED_FACTOR) return false;
    this.sharedHits++;
    return true;
  }

  /** Keys held, of both maps. */
  get size(): number {
    return this.hits.size + this.coarseHits.size;
  }
}

function count(hits: Map<string, number>, key: string, limit: number) {
  const seen = hits.get(key) ?? 0;
  if (seen >= limit) return false;
  hits.set(key, seen + 1);
  return true;
}
