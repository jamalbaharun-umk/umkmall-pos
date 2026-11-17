import { tokens } from './generated';

/**
 * The Foundation hierarchy mirrors Ensyra's Figma page names, not our file layout, so a
 * Figma-vs-code disagreement is a per-collection diff (UMK-879 R6).
 */
export const FOUNDATION_PAGES = [
  'Color',
  'Typography',
  'Layout, Spacing, Image',
] as const;

export type FoundationPage = (typeof FOUNDATION_PAGES)[number];

/** Token GROUP keys, which are camelCase in `generated.ts`. The page names above are Figma's
 *  own page titles and stay as published — they are display strings, not token keys. */
const COLOR_GROUPS = new Set([
  'brand',
  'neutral',
  'red',
  'green',
  'yellow',
  'text',
  'icon',
  'surface',
  'border',
  'callout',
  /* The overlay's surviving focus stop. `chat` and `composer` left with the 2026-09-08
     restructure — `chat` had no consumers, and the composer's shell resolves to ordinary
     Surface and Border tokens (UMK-978). */
  'focus',
]);

/**
 * The mapping is hand-written, so everything unmapped falls through to a default page
 * rather than vanishing. `generated.ts` is regenerated from Figma and its group list has
 * already moved once (Space → Spacing, plus Chat); a new group landing on the wrong page
 * is visible and cheap to fix, a new group landing nowhere is neither.
 */
export function pageForGroup(group: string): FoundationPage {
  if (COLOR_GROUPS.has(group)) return 'Color';
  /* `typography` is the composite scale a component actually renders; `font` is the raw ladder
     Ensyra publishes underneath it (sizes, line heights, tracking, weights, family). Same page —
     a reader looking for type wants both, and the fallback bucket is for measurements. */
  if (group === 'typography' || group === 'font') return 'Typography';
  return 'Layout, Spacing, Image';
}

export function groupsForPage(
  page: FoundationPage,
  groups: readonly string[] = Object.keys(tokens),
): string[] {
  return groups.filter((group) => pageForGroup(group) === page);
}

export type TokenLeaf = { path: string; value: string | number };

/** Flattens a token group into `path → value` pairs, whatever its nesting depth. */
export function flattenGroup(value: unknown, path: string[] = []): TokenLeaf[] {
  if (typeof value === 'string' || typeof value === 'number') {
    return [{ path: path.join(' / '), value }];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => flattenGroup(child, [...path, key]));
  }
  return [];
}
