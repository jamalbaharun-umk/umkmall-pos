import React from 'react';

/**
 * The reader's in-app text size (UMK-1832, "Bacaan"). The four steps and their multipliers are the
 * web's (UMK-1325, `apps/main-website/app/globals.css` `--ds-text-scale`), copied rather than shared:
 * only native reads this table today. Change one, change the other.
 */
export const TEXT_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const DEFAULT_TEXT_SIZE: TextSize = 'md';
export const TEXT_SIZE_SCALE: Readonly<Record<TextSize, number>> = { sm: 0.875, md: 1, lg: 1.125, xl: 1.25 };

export const isTextSize = (value: unknown): value is TextSize => TEXT_SIZES.includes(value as TextSize);

/**
 * A whole style at the reader's size: `fontSize` and `lineHeight` multiplied and rounded to whole pixels,
 * everything else untouched. The same object back at 1. For `Text`'s final style (so a caller's own
 * `fontSize` override follows the setting too) and for a raw `TextInput` an app draws itself.
 */
export function scaleTextStyle<S extends { fontSize?: number; lineHeight?: number }>(style: S, scale: number): S {
  if (scale === 1) return style;
  return {
    ...style,
    ...(style.fontSize !== undefined ? { fontSize: Math.round(style.fontSize * scale) } : null),
    ...(style.lineHeight !== undefined ? { lineHeight: Math.round(style.lineHeight * scale) } : null),
  };
}

/* 1 with no provider: a screen, a test or the playbook mounted without one draws today's sizes. */
const TextScaleContext = React.createContext(1);

/**
 * Hands every design-system text under it the multiplier for `size`. The app mounts ONE at its root;
 * the mount guard in `apps/mobile/src/settings/__tests__` fails when it stops, because a missing provider looks
 * exactly like a working one at `md`.
 */
export const TextScaleProvider = ({ size, children }: { size: TextSize; children: React.ReactNode }) => (
  <TextScaleContext.Provider value={TEXT_SIZE_SCALE[size]}>{children}</TextScaleContext.Provider>
);

/** The multiplier in force here, for `resolveTextStyle`'s third argument or a raw size. */
export const useTextScale = (): number => React.useContext(TextScaleContext);
