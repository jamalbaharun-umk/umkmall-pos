/**
 * The credit coin's colours, on both platforms, are the tokens they claim to be (UMK-1218).
 *
 * The coin is the one house glyph NOT produced by the native generator (its gradient id comes from
 * `useId`), so nothing mechanical ties the web drawing to the native one — the generator's `--check`
 * cannot see a native coin that drifted, and a hex typed into either file passes every other guard.
 * Read as TEXT, like `icon-parity.test.ts`, because the native file imports `react-native-svg`.
 *
 * - WEB: every `var(--token, R G B)` names a variable `tokens.css` declares, and its FALLBACK is that
 *   variable's own value — so a page without the stylesheet draws the same coin, not a black disc, and
 *   a token change cannot leave a stale fallback behind.
 * - NATIVE: the sweep reads `tokens.surface.gradient.yellow.start/.end` and the mark
 *   `tokens.icon.default.invert`, the path is the SHARED constant, and there is no hex literal.
 *
 * PROVED RED, one injection each, reverted:
 * | Injection | Reds |
 * | -- | -- |
 * | web end-stop fallback `172 111 8` → `0 0 0` | web fallbacks equal the token values |
 * | native end stop → `tokens.surface.gradient.brand.end` | native reads the coin tokens |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const WEB = read('primitives/Icon/glyphs/credit-coin.tsx');
const NATIVE = read('native/glyphs/credit-coin.tsx');
const TOKENS_CSS = readFileSync(resolve(SRC, '..', 'tokens.css'), 'utf8');

const declared = (name: string) =>
  TOKENS_CSS.match(new RegExp(`${name}:\\s*(\\d+\\s+\\d+\\s+\\d+)\\s*;`))?.[1].replace(/\s+/g, ' ') ?? null;

describe('the credit coin reads its tokens (UMK-1218)', () => {
  it('web: each var() names a declared token and falls back to that token\'s own value', () => {
    const uses = [...WEB.matchAll(/var\((--[a-z0-9-]+),\s*(\d+ \d+ \d+)\)/g)].map((m) => [m[1], m[2]]);
    expect(uses.map(([name]) => name).sort()).toEqual([
      '--icon-default-invert',
      '--surface-gradient-yellow-end',
      '--surface-gradient-yellow-start',
    ]);
    for (const [name, fallback] of uses) expect(fallback, name).toBe(declared(name));
    // No var() WITHOUT a fallback slipped in beside them.
    expect(WEB.match(/var\(--/g)).toHaveLength(uses.length);
  });

  it('native: the sweep and the mark are the same tokens, read as values, over the shared path', () => {
    expect(NATIVE).toMatch(/stopColor=\{tokens\.surface\.gradient\.yellow\.start\}/);
    expect(NATIVE).toMatch(/stopColor=\{tokens\.surface\.gradient\.yellow\.end\}/);
    expect(NATIVE).toMatch(/fill=\{tokens\.icon\.default\.invert\}/);
    expect(NATIVE).toMatch(/d=\{CREDIT_COIN_MARK_PATH\}/);
    expect(WEB).toMatch(/d=\{CREDIT_COIN_MARK_PATH\}/);
    expect(NATIVE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
