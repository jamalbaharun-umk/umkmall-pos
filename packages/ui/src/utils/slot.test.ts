import { describe, expect, it } from 'vitest';
import { isSlotFilled } from './slot';

/**
 * `isSlotFilled` had no test of its own at all, and it is the one place in this package that
 * decides whether a shell renders a padded box or nothing.
 *
 * WHY THE VALUES BELOW AND NOT A TRUTHINESS TABLE. The predicate is not "is this truthy" — it is
 * "would React render this as nothing". Those disagree on exactly the two entries that matter:
 * `''` and `0` are falsy and DO render, so they are filled; `true` and `[]` are truthy and render
 * NOTHING, so they are not. Each direction is asserted here because a rewrite in either direction
 * looks correct and is invisible in a screenshot — an empty slot is padding, not pixels.
 */
describe('isSlotFilled', () => {
  it('treats the nodes React drops as an empty slot', () => {
    for (const content of [undefined, null, false, true, []]) expect(isSlotFilled(content)).toBe(false);
  });

  /* The realistic one, spelled out on its own: a caller mapping an empty list into a slot. */
  it('treats a mapped-over empty list as an empty slot', () => {
    const items: string[] = [];
    expect(isSlotFilled(items.map((i) => i))).toBe(false);
  });

  it('keeps the falsy content React does render', () => {
    expect(isSlotFilled('')).toBe(true);
    expect(isSlotFilled(0)).toBe(true);
  });

  it('keeps ordinary content, including a non-empty list', () => {
    expect(isSlotFilled('x')).toBe(true);
    expect(isSlotFilled(['x'])).toBe(true);
  });
});
