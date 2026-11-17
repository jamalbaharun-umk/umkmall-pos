import { describe, expect, it } from 'vitest';
import { tokens } from './generated';
import { FOUNDATION_PAGES, flattenGroup, groupsForPage, pageForGroup } from './foundation-pages';
import * as FoundationStories from './Foundation.stories';

// The story list is what actually renders, so it is the independent source this file
// checks the page mapping against. Asserting the mapping against its own default argument
// would only restate `pageForGroup`'s type.
const { default: meta, ...stories } = FoundationStories;
const renderedPages = Object.values(stories).map((story) => story.args.page);

describe('Foundation pages', () => {
  // Asserted by iterating the token object rather than against a hard-coded list:
  // `generated.ts` is regenerated from Figma, so a hand-listed check goes stale silently.
  it('places every published token group on a page', () => {
    const placed = FOUNDATION_PAGES.flatMap((page) => groupsForPage(page));
    expect(placed.sort()).toEqual(Object.keys(tokens).sort());
  });

  // Without this, a page added to FOUNDATION_PAGES but never given a story collects groups
  // that render nowhere — the exact disappearance the fallback bucket exists to prevent.
  it('renders a story for every page a token group can land on', () => {
    /* `Foundations`, plural, and it moved with `storySort` in preview.ts — renaming this
       without moving that leaves the section empty (UMK-979 U5). It is the token page, so it
       has no contract entry and no `storyTitle` to derive from; the literal is the whole
       assertion. */
    expect(meta.title).toBe('Foundations');
    expect([...renderedPages].sort()).toEqual([...FOUNDATION_PAGES].sort());
  });

  it('renders every published token group in some story', () => {
    const rendered = renderedPages.flatMap((page) => groupsForPage(page));
    expect(rendered.sort()).toEqual(Object.keys(tokens).sort());
  });

  // Preview's version of this was written to fail the moment UMK-895 added Desktop, so that
  // the second half of the scale could not land silently. It did fail; this is the deliberate
  // update it asked for.
  //
  // 'typography' is the token GROUP key (camelCase, as generated.ts spells it); 'Typography'
  // is the Figma PAGE name. They are deliberately different namespaces.
  it('carries the whole type scale, both platforms', () => {
    expect(pageForGroup('typography')).toBe('Typography');
    expect(groupsForPage('Typography').sort()).toEqual(['font', 'typography']);
    expect(Object.keys(tokens.typography)).toEqual(['mobile', 'desktop']);
    // Every role on both platforms, so a half-published platform cannot pass.
    expect(Object.keys(tokens.typography.mobile)).toHaveLength(11);
    expect(Object.keys(tokens.typography.desktop)).toHaveLength(11);
  });

  it('sends an unmapped group to the fallback page rather than dropping it', () => {
    expect(pageForGroup('Elevation')).toBe('Layout, Spacing, Image');
    expect(groupsForPage('Layout, Spacing, Image', ['Elevation'])).toEqual(['Elevation']);
  });

  // THE FALLBACK IS WHY THE TEST ABOVE CANNOT SEE A MISPLACED GROUP (UMK-978). Every group
  // lands SOMEWHERE by construction, so 'places every published token group on a page' is
  // unfalsifiable for a new one — it passes whether the group was mapped deliberately or
  // swept into the bucket. Ensyra's restructure added `shadow`, `opacity` and `percentage`
  // at once, and all three belong here; `focus` is a colour and must NOT. Enumerated, so a
  // group joining the bucket by accident has to be admitted here on purpose.
  it('names exactly which groups live on the fallback page', () => {
    expect(groupsForPage('Layout, Spacing, Image').sort()).toEqual(
      ['borderWidth', 'elevation', 'margin', 'measurement', 'motion', 'opacity', 'percentage', 'radius', 'shadow', 'spacing'].sort(),
    );
    expect(pageForGroup('focus')).toBe('Color');
    /* native-ui-v2: `motion` is a measurement and belongs in the bucket. (`blur` and `glow` left
       with the glass blur and the mesh, UMK-1603.) */
    /* The raw type ladder belongs with the scale it feeds, not in the measurement bucket. */
    expect(pageForGroup('font')).toBe('Typography');
  });

  it('flattens nested groups down to their leaf values', () => {
    expect(flattenGroup(tokens.callout)).toContainEqual({
      path: 'default / surface',
      value: tokens.callout.default.surface,
    });
    expect(flattenGroup(tokens.spacing).length).toBe(Object.keys(tokens.spacing).length);
  });
});
