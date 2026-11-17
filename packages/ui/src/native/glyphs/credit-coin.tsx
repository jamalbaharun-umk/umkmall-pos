import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { tokens } from '../../tokens';
import { CREDIT_COIN_MARK_PATH } from '../../shared/credit-coin';
import type { HouseGlyph } from './index';

/**
 * The Teman AI coin on native — the twin of the web's `glyphs/credit-coin.tsx` (UMK-1218).
 *
 * Hand-written, not generated: the web glyph takes a per-instance gradient id from `useId`, and the
 * generator reads only hook-free glyphs. The path is the web's constant (imported, not retyped), and
 * the colours are the same tokens read as values: the `surface.gradient.yellow` sweep and the
 * `icon.default.invert` mark. Fixed palette, so `color` is not read.
 *
 * `LinearGradient` here is `react-native-svg`'s SVG gradient, not `expo-linear-gradient` — the
 * package's one-route rule (`gradient-one-route.test.ts`) is about the latter.
 */
export const GlyphCreditCoin: HouseGlyph = ({ size, style, ...a11y }) => {
  const gradientId = `credit-coin-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={style} {...a11y}>
      <Circle cx="16" cy="16" r="16" fill={`url(#${gradientId})`} />
      <Path d={CREDIT_COIN_MARK_PATH} fill={tokens.icon.default.invert} />
      <Defs>
        <LinearGradient id={gradientId} x1="16" y1="0" x2="16" y2="32" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={tokens.surface.gradient.yellow.start} />
          <Stop offset="1" stopColor={tokens.surface.gradient.yellow.end} />
        </LinearGradient>
      </Defs>
    </Svg>
  );
};
