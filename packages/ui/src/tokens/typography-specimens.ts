import { TEXT_ROLES, TEXT_ROLE_WEIGHTS, TEXT_WEIGHTS } from '../contract';
import { tokens } from './generated';

/**
 * The data behind Foundation → Typography. JSX-free on purpose: the story renders it and the
 * guard asserts it, so both read one model rather than two hand-kept copies.
 *
 * **The hazard this module exists to contain.** Role keys are camelCase (`bodyLg`); the vars
 * `tokens.css` emits are kebab (`--typography-mobile-body-lg-semibold`). A naive
 * `--typography-${platform}-${role}-${weight}` composes a name that does not exist — and an
 * undefined `var()` inside a `font` shorthand invalidates the WHOLE declaration, so the
 * specimen falls back to the browser default. It still renders text, it still looks plausible,
 * and nothing errors. Same silent-drop class `apps/design/src/tailwind.css` documents for the
 * font variable, and the same one `composites.test.ts` documents for unitless lengths.
 *
 * So the conversion is an explicit map, not a regex, and `typography-specimens.test.tsx`
 * cross-checks every composed name against `tokens.css` itself.
 */

export const TYPOGRAPHY_PLATFORMS = ['desktop', 'mobile'] as const;

export type TypographyPlatform = (typeof TYPOGRAPHY_PLATFORMS)[number];
export type TypographyRole = (typeof TEXT_ROLES)[number];
export type TypographyWeight = (typeof TEXT_WEIGHTS)[number];

/**
 * Role key → the segment the token pipeline slugs into the var name.
 *
 * Written out rather than derived, for the same reason `Text.tsx`'s `SCALE` is: the two
 * vocabularies differ on purpose and a derivation breaks silently the first time either side
 * renames. That makes this the THIRD hand-maintained copy of one transformation (the build
 * script's `name/umkmall` transform and `SCALE` are the others). The drift guard pins this one
 * against `SCALE` so the two in `src/` cannot disagree without going red.
 */
export const ROLE_SEGMENTS = {
  display: 'display',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  paragraph: 'paragraph',
  bodyLg: 'body-lg',
  bodyMd: 'body-md',
  bodySm: 'body-sm',
} satisfies Record<TypographyRole, string>;

/** The Figma page's own row labels, which are not the code's role keys. */
export const ROLE_LABELS = {
  display: 'Display',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  paragraph: 'Paragraph',
  bodyLg: 'Body Lg',
  bodyMd: 'Body Md',
  bodySm: 'Body Sm',
} satisfies Record<TypographyRole, string>;

export function typographyVar(
  platform: TypographyPlatform,
  role: TypographyRole,
  weight: TypographyWeight,
): string {
  return `--typography-${platform}-${ROLE_SEGMENTS[role]}-${weight}`;
}

/**
 * The number cells in BOTH sections use `Desktop/Heading 4/Medium`, because that is what the
 * Figma page does. The Mobile section's numbers therefore render at the same 24px as the
 * Desktop section's — deliberate, and the reason only the Style column changes between sections.
 */
export const NUMBER_STYLE_VAR = typographyVar('desktop', 'h4', 'medium');

export interface TypographySpecimen {
  platform: TypographyPlatform;
  role: TypographyRole;
  weight: TypographyWeight;
  /** The `--typography-…` custom property that paints this style. */
  cssVar: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  /** Unitless, as `generated.ts` publishes it. `undefined` on the 64 styles that publish none —
   *  NOT `0`, which would claim a value the token does not carry. */
  letterSpacing?: number;
  /** The same value with a unit, ready for CSS. A bare `-0.36` is invalid and the browser drops
   *  the declaration with nothing red, so never hand `letterSpacing` itself to a style prop. */
  letterSpacingCss?: string;
}

/**
 * All 80 published styles, 40 per platform. The page paints 23 of them, but the inventory stays
 * complete because the var-resolution guard is what catches a pipeline rename — and it costs
 * nothing to catch it for every role rather than only the ones this page happens to show.
 *
 * Iterates `TEXT_ROLE_WEIGHTS`, never `TEXT_WEIGHTS`: `display` and `h1` publish two weights,
 * and the flat list would invent 12 styles that do not exist.
 */
export const TYPOGRAPHY_SPECIMENS: readonly TypographySpecimen[] = TYPOGRAPHY_PLATFORMS.flatMap(
  (platform) =>
    TEXT_ROLES.flatMap((role) =>
      TEXT_ROLE_WEIGHTS[role].map((weight): TypographySpecimen => {
        const style = tokens.typography[platform][role][
          weight as keyof (typeof tokens.typography)[typeof platform][typeof role]
        ] as {
          fontSize: number;
          lineHeight: number;
          fontWeight: number;
          letterSpacing?: number;
        };

        return {
          platform,
          role,
          weight,
          cssVar: typographyVar(platform, role, weight),
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          letterSpacingCss:
            style.letterSpacing === undefined
              ? undefined
              : `${+(style.letterSpacing / style.fontSize).toFixed(6)}em`,
        };
      }),
    ),
);

/**
 * Recovers the design's own unit for the Tracking column.
 *
 * The Figma page specifies tracking as a PERCENTAGE of the font size; the publish step resolves
 * it to px, and that resolved px is what `generated.ts` carries. They are the same value:
 *
 * | role            | Figma | × size | token  |
 * |-----------------|-------|--------|--------|
 * | Desktop Display | −1%   | 56     | −0.56  |
 * | Desktop H1      | −0.3% | 40     | −0.12  |
 * | Desktop H2      | −0.1% | 32     | −0.032 |
 * | Mobile Display  | −1%   | 36     | −0.36  |
 *
 * The column must show the percentage, because printing the px value under a header that says
 * "Tracking" is not what the design means by tracking. Rounded to the design's one-decimal
 * precision; roles that publish no letterSpacing show `0`, matching the Figma page.
 */
export function trackingPercent(fontSize: number, letterSpacing?: number): number {
  if (letterSpacing === undefined) return 0;
  return Math.round((letterSpacing / fontSize) * 1000) / 10;
}

export interface TypographyRow {
  role: TypographyRole;
  label: string;
  /** The var that typesets the Style cell — this row's own role at Semibold on this platform. */
  styleVar: string;
  fontSize: number;
  lineHeight: number;
  trackingPercent: number;
  letterSpacingCss?: string;
  /** The OTHER platform's size for the same role — the column Figma does not have, so the
   *  mobile/desktop offset is readable without scrolling between sections. */
  otherPlatformFontSize: number;
}

const semiboldOf = (platform: TypographyPlatform, role: TypographyRole) =>
  TYPOGRAPHY_SPECIMENS.find(
    (s) => s.platform === platform && s.role === role && s.weight === 'semibold',
  )!;

function rowsFor(platform: TypographyPlatform): readonly TypographyRow[] {
  const other = platform === 'desktop' ? 'mobile' : 'desktop';

  return TEXT_ROLES.map((role): TypographyRow => {
    const style = semiboldOf(platform, role);

    return {
      role,
      label: ROLE_LABELS[role],
      styleVar: style.cssVar,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      trackingPercent: trackingPercent(style.fontSize, style.letterSpacing),
      letterSpacingCss: style.letterSpacingCss,
      otherPlatformFontSize: semiboldOf(other, role).fontSize,
    };
  });
}

/** The 11 roles in published order (descending by size), per platform. */
export const TYPOGRAPHY_ROWS: Record<TypographyPlatform, readonly TypographyRow[]> = {
  desktop: rowsFor('desktop'),
  mobile: rowsFor('mobile'),
};

/** The legend above both sections. Weight is a legend, not a row axis. */
export const WEIGHT_LEGEND = [
  ['Bold', 700],
  ['Semibold', 600],
  ['Medium', 500],
  ['Regular', 400],
] as const;
