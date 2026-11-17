import Svg, { Circle, Path } from 'react-native-svg';
import { CREDIT_COIN_MARK_PATH } from '../shared/credit-coin';
import { tokens } from './theme';

/**
 * The native-ui-v2 coin: a flat `icon.coin.default` disc with the white Teman AI mark
 * (docs/guidelines/mobile-design-identity.md §2.2, §4.7). Drawn by `CoinChip` and `PhotoCard`.
 *
 * NOT A REGISTRY GLYPH, and that is the registry's own rule rather than a shortcut. `ICON_REGISTRY`
 * names exactly the glyphs the WEB registry names (`icon-parity.test.ts`), so registering this one
 * would mean adding a web glyph for an identity the web does not follow. The registry's
 * `credit-coin` is the web's coin — a `surface.gradient.yellow` sweep — and stays as it is.
 *
 * The MARK is not redrawn: it is `CREDIT_COIN_MARK_PATH`, the one constant both platforms'
 * `credit-coin` glyphs already import, so the three coins cannot draw different marks. Only the
 * disc differs, which is the identity's change.
 */
export const CoinGlyph = ({ size }: { size: number }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    testID="coin-glyph"
  >
    <Circle cx="16" cy="16" r="16" fill={tokens.icon.coin.default} />
    <Path d={CREDIT_COIN_MARK_PATH} fill={tokens.icon.default.invert} />
  </Svg>
);
