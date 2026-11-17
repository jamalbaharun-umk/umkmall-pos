import { useId, type SVGProps } from 'react';
import { CREDIT_COIN_MARK_PATH } from '../../../shared/credit-coin';

/**
 * The Teman AI coin — Figma's `Teman AI Coins` (`Type=Non Label, Color=Full Color`; Teman AI Page
 * `WE0rXA29d9M54Sm2dghsBL`, e.g. the coin pill 14275:103259 and "Koin Saat Ini" 14275:102337): a
 * disc swept top to bottom from `#F59E0B` to `#AC6F08`, with the white Teman AI mark on it. The path
 * data is the product owner's export, verbatim (UMK-1218). It replaced an 18px three-gold coin that
 * was not the design's.
 *
 * FIXED PALETTE, from TOKENS. It draws in its own colours (the registry marks it `fixedPalette`, so
 * the `color` axis is ignored), and every one of them is a design token, not a hex:
 *
 * - the sweep is `surface.gradient.yellow` — `start` `#F59E0B`, `end` `#AC6F08`, exactly the design's
 *   two stops (`--surface-gradient-yellow-start` / `-end`);
 * - the mark is `icon.default.invert` `#FFFFFF` (`--icon-default-invert`).
 *
 * They are `style` declarations reading the token variables, because a presentation attribute
 * (`stop-color="…"`) does not take `var()` reliably and no Tailwind utility sets `stop-color`. Each
 * `var()` carries the token's own value as its FALLBACK (the `Toaster` precedent): a page that does
 * not load `tokens.css` still draws the coin, where an undefined variable would leave `stop-color` at
 * its initial black and paint a black disc. `coin-fallbacks.test.ts` pins each fallback to the token.
 *
 * A PER-INSTANCE GRADIENT ID. Several coins render on one page (the pill, the Koin card, cost badges,
 * a coin stack), and `url(#id)` resolves to the FIRST element with that id in the document. With a
 * shared id every coin paints from one `<linearGradient>` — and when that first one sits in a
 * `display:none` subtree (the desktop pill below `lg`, a closed modal) browsers paint the others with
 * NO fill at all. `useId` gives each coin its own. On the React this repo runs (19.2) that id is
 * already `_r_N_`, a plain token inside `url(#…)`; earlier versions produced `:r0:` (≤ 19.0) and
 * `«r0»` (19.1). The strip below is a harmless defence against those formats coming back, not
 * something the current version needs.
 *
 * Not generated for native: the generator reads only hook-free `(props) => (<svg>)` glyphs, so the
 * native twin is hand-written in `native/glyphs/credit-coin.tsx` over the same path and tokens.
 */
export const GlyphCreditCoin = (props: SVGProps<SVGSVGElement>) => {
  const gradientId = `credit-coin-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="16" cy="16" r="16" fill={`url(#${gradientId})`} />
      <path d={CREDIT_COIN_MARK_PATH} style={{ fill: 'rgb(var(--icon-default-invert, 255 255 255))' }} />
      <defs>
        <linearGradient id={gradientId} x1="16" y1="0" x2="16" y2="32" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: 'rgb(var(--surface-gradient-yellow-start, 245 158 11))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--surface-gradient-yellow-end, 172 111 8))' }} />
        </linearGradient>
      </defs>
    </svg>
  );
};
