import type { StyleProp, ViewStyle } from 'react-native';

/**
 * House glyphs on native — the artwork with no lucide equivalent.
 *
 * The drawings live in `generated.tsx`, produced from the web glyph file by
 * `packages/ui/scripts/generate-native-glyphs.mjs`: the path data is byte-identical to the
 * web's, `currentColor` became the `color` prop, and every other literal fill is artwork.
 * UMK-952 kept house glyphs unported because porting them by hand was the real cost; the
 * generator makes the port mechanical, so the whole set ships and re-ships when a glyph
 * changes on the web.
 *
 * Every glyph takes the same props `Icon` hands a lucide component (`size`, `color`,
 * `strokeWidth`, `style`, the accessibility props), so the registry can hold either kind
 * and `Icon` does not care which it got.
 */
export interface HouseGlyphProps {
  size: number;
  color: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  accessible?: boolean;
  accessibilityRole?: 'image';
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
}

export type HouseGlyph = (props: HouseGlyphProps) => React.JSX.Element;

export * from './generated';
export * from './credit-coin';
