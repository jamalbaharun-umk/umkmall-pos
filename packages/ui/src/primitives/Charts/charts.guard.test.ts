import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAIN_TEXT_SIZE, PX_FONT_SIZE } from '../../no-px-font-size.test';

const DIR = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));

/* Same matchers as src/no-raw-colour.test.ts: hex, rgb()/hsl()/oklch()/color-mix() not reading a variable, palette classes. */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\((?!\s*var\()/;
const PALETTE = /\b(?:text|bg|border|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe('chart sources', () => {
  it('reads the files it guards', () => {
    expect(sources.length).toBeGreaterThan(12);
  });
  it('holds no raw colour: every colour is a token', () => {
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(HEX.test(code), `${f}: hex`).toBe(false);
      expect(COLOUR_FN.test(code), `${f}: colour function`).toBe(false);
      expect(PALETTE.test(code), `${f}: palette class`).toBe(false);
    }
  });
  it('writes no px or plain Tailwind font size', () => {
    for (const { f, text } of sources) {
      expect(PX_FONT_SIZE.test(text), `${f}: px`).toBe(false);
      expect(PLAIN_TEXT_SIZE.test(text), `${f}: plain size`).toBe(false);
    }
  });
  it('can render on the server: no window, document, localStorage, Intl or toFixed', () => {
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(/\b(?:window|document|localStorage|sessionStorage|navigator)\b/.test(code), `${f}: browser global`).toBe(false);
      expect(/toLocaleString|Intl\.|toFixed|Math\.random|Date\.now|new Date/.test(code), `${f}: nondeterministic or float formatting`).toBe(false);
    }
  });
  it('reads ResizeObserver only inside an effect (hooks.ts)', () => {
    const hooks = readFileSync(join(DIR, 'hooks.ts'), 'utf8');
    expect(hooks).toMatch(/useEffect\(\(\) => \{[\s\S]*ResizeObserver/);
  });
});
