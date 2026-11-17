import type { TextStyle, ViewStyle } from 'react-native';
import { tokens } from '../tokens';
import { TEXT_COLORS, TEXT_ROLES, TEXT_ROLE_WEIGHTS, TEXT_WEIGHTS } from '../contract';

/**
 * Derived from the contract, not imported from `../utils`. That module maps the vocabulary
 * to Tailwind classes — pulling it in here would put web styling on the native import graph
 * for the sake of a type alias.
 */
export type TextColor = (typeof TEXT_COLORS)[number];
export type TextRole = (typeof TEXT_ROLES)[number];
export type TextWeight = (typeof TEXT_WEIGHTS)[number];

/** The weights a given role actually publishes. `display` and `h1` have two. */
export type WeightFor<R extends TextRole> = (typeof TEXT_ROLE_WEIGHTS)[R][number];

/**
 * The token bridge for React Native.
 *
 * There is no conversion here and there must not be: `generated.ts` already holds hex
 * colours and unitless integers, which is exactly what `StyleSheet` wants. The web appends
 * `px` at the Tailwind emitter, not in the token file (UMK-909). Anything in this module
 * that parses a token is converting a value that was never a string.
 *
 * What it does add is the same INDIRECTION the web gets from `TEXT_COLOR_CLASSES`: the
 * contract owns the colour vocabulary, and each platform maps that vocabulary to its own
 * representation — Tailwind classes there, hex here. Both sides read one list, so a colour
 * cannot exist on one platform only.
 */
export const TEXT_COLOR_VALUES = {
  primary: tokens.text.default.primary,
  secondary: tokens.text.default.secondary,
  disable: tokens.text.disable.primary,
  invert: tokens.text.default.invert,
  brand: tokens.text.default.brand,
  success: tokens.text.default.success,
  error: tokens.text.default.error,
  warning: tokens.text.default.warning,
  muted: tokens.text.default.muted,
} satisfies Record<TextColor, string>;

/**
 * The same vocabulary, resolved against the `Icon` token group rather than `Text`. The two
 * groups publish identical hexes today; they are separate groups in Figma, so an icon reads
 * the icon group and a later divergence lands where the design put it.
 *
 * THE WEB CANNOT DO THIS AND DELIBERATELY DOES NOT TRY (KTD2, UMK-978). There, SVG takes its
 * colour from `currentColor`, so every icon already wore a `text-` utility and a second
 * byte-identical palette bought nothing — `icon-*` retired and the emitter throws if the two
 * groups ever diverge. Here the divergence would be free, so the indirection stays. If design
 * does split them, the build fails on the web side first and names the leaf.
 */
export const ICON_COLOR_VALUES = {
  primary: tokens.icon.default.primary,
  secondary: tokens.icon.default.secondary,
  disable: tokens.icon.disable.primary,
  invert: tokens.icon.default.invert,
  brand: tokens.icon.default.brand,
  success: tokens.icon.default.success,
  error: tokens.icon.default.error,
  warning: tokens.icon.default.warning,
  /* The icon group publishes no muted; the web Icon reads the Text colour class, so this is the Text group's value (UMK-1548). */
  muted: tokens.text.default.muted,
} satisfies Record<TextColor, string>;

/**
 * Weight → registered font family.
 *
 * **Android does not synthesise weights from a static font file.** Asking for
 * `fontWeight: '700'` against the Regular file yields a faked bold that does not match web
 * and looks close enough to pass a glance; setting family and weight together double-bolds.
 * So each weight is its own family and a style sets `fontFamily` INSTEAD of `fontWeight`.
 *
 * These are NAMES, not assets. The app registers the matching files with `expo-font`
 * (`@expo-google-fonts/be-vietnam-pro`), which is why this package needs no Expo dependency
 * — a library that bundled font binaries would force every web consumer to carry them.
 */
export const FONT_FAMILY_BY_WEIGHT = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
} as const satisfies Record<TextWeight, string>;

export type ResolvedTextStyle = Pick<
  TextStyle,
  'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'
>;

/**
 * The single place a type step becomes a React Native style.
 *
 * Reads `tokens.typography.mobile` — the MOBILE half of the scale, always. The web component
 * now does the same at every viewport: its `lg:` Desktop step was dropped (53b384ab6) until
 * the desktop redesign lands, so the two surfaces render one size per role. A tablet is out
 * of scope until something asks for it (`app.config.ts` sets `supportsTablet: false`).
 *
 * The size/lineHeight pair is copied from the token, never re-derived. The design pairs an
 * ABSOLUTE lineHeight with each size, and a multiplier rounds differently — subtly wrong
 * everywhere at once, which is the hardest kind of visual bug to notice (UMK-910).
 * The ONE exception is the reader's own text size (UMK-1832, `TextScaleProvider`): `readerScale` other
 * than 1 multiplies both and rounds each to a whole pixel. At 1 the token pair comes back as is.
 *
 * Every component that draws text — `Text`, and the `TextInput` inside `TextField` — goes
 * through here, so the Android weight rule above is applied in one place rather than
 * remembered in each.
 */
export function resolveTextStyle(role: TextRole, weight: TextWeight, readerScale = 1): ResolvedTextStyle {
  const scale = tokens.typography.mobile[role] as Record<
    string,
    { fontSize: number; lineHeight: number; letterSpacing?: number }
  >;
  const step = scale[weight];

  /**
   * The types make this unreachable from TypeScript call sites. It fires when a role/weight
   * pairing the scale does not publish arrives from untyped data — and without it the style
   * is `undefined`, React Native renders at its own default, and the screen looks subtly
   * wrong rather than broken.
   */
  if (!step) {
    throw new Error(
      `Text: the type scale publishes no '${weight}' weight for '${role}'. ` +
        `Available: ${Object.keys(scale).join(', ')}.`,
    );
  }

  return {
    // No `fontWeight` here, deliberately — see FONT_FAMILY_BY_WEIGHT.
    fontFamily: FONT_FAMILY_BY_WEIGHT[weight],
    fontSize: readerScale === 1 ? step.fontSize : Math.round(step.fontSize * readerScale),
    lineHeight: readerScale === 1 ? step.lineHeight : Math.round(step.lineHeight * readerScale),
    ...(step.letterSpacing !== undefined ? { letterSpacing: step.letterSpacing } : {}),
  };
}

/**
 * A shadow token as React Native draws it.
 *
 * iOS reads the four `shadow*` props; Android ignores every one of them and reads
 * `elevation` instead, so a style that sets only the iOS props renders as NOTHING there.
 * Android's elevation shadow is roughly twice the elevation in blur, so the token's blur
 * halves to get there (the playbook's Foundation sheet established the ratio by eye).
 */
export function shadowStyle(shadow: {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
}): ViewStyle {
  return {
    shadowColor: shadow.color,
    shadowOffset: { width: shadow.offsetX, height: shadow.offsetY },
    shadowRadius: shadow.blur,
    shadowOpacity: 1,
    elevation: Math.max(1, Math.round(shadow.blur / 2)),
  };
}

/**
 * A token colour at an opacity — the native spelling of a web class's `/NN` modifier
 * (a brand ring at 30%, an inverted surface at 55%), as an 8-digit hex (UMK-1317). The web class
 * names are not quoted in this file on purpose: Tailwind scans it as text and compiles any class
 * it finds in a comment (`inline-classes.purge.test.ts`).
 *
 * ONE HELPER so a translucent colour is always a TOKEN plus a number, never a typed `rgba()`
 * string or a `${token}cc` concatenation — both of which name a colour no token publishes and
 * neither of which a hex guard reads.
 *
 * THE MODIFIER REPLACES THE COLOUR'S OWN ALPHA, as Tailwind v3's does: `surface.default.overlay`
 * is published as `#04264899`, and the web paints it at `/40` as 40%, not as 40% of 60%.
 *
 * NOT FOR AN SVG STOP OR A SHADOW. `react-native-svg` keeps only the rgb of a `stopColor`, and
 * Android draws an elevation shadow from the colour's own alpha — both want an OPAQUE colour and
 * a separate opacity.
 *
 * Throws on anything that is not a 6- or 8-digit hex: a token that resolved to `undefined`
 * would otherwise become the string `"undefined4d"`, which React Native paints as nothing.
 */
export function withAlpha(hex: string, percent: number): string {
  if (typeof hex !== 'string' || !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) {
    throw new Error(`withAlpha: '${String(hex)}' is not a 6- or 8-digit hex colour`);
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`withAlpha: ${String(percent)} is not a percentage between 0 and 100`);
  }
  const alpha = Math.round((percent / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${alpha}`;
}

/**
 * The measurement ladder, under the name the tables below read it by. Tailwind's spacing
 * scale (`h-7`, `px-10`, `w-14`) has no semantic token behind it on the web, but the
 * pipeline publishes the same rem ladder as `measurement`, keyed by the rem value with the
 * dot spelled as a dash — `'1-75'` is 28. Reading a size from here rather than typing `28`
 * keeps the native tables on the same source the web ones will migrate to.
 */
export const measure = tokens.measurement;

/** Re-exported so a screen reaches one module for colour, spacing, radius and type. */
export { tokens };
export { TEXT_COLORS };
