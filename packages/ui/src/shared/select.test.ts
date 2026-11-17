import { describe, expect, it } from 'vitest';
import { canCreateOption } from './select';

const on = { enabled: true, showSearch: true };

describe('canCreateOption', () => {
  it('hides the row when at least one option matches', () => expect(canCreateOption(1, 'abc', on)).toBe(false));
  it('hides the row below the minimum length', () => expect(canCreateOption(0, 'ab', on)).toBe(false));
  it('measures the trimmed query', () => expect(canCreateOption(0, '  ab ', on)).toBe(false));
  it('shows the row at the minimum length with no match', () => expect(canCreateOption(0, 'abc', on)).toBe(true));
  it('hides the row while options are loading', () => expect(canCreateOption(0, 'abc', { ...on, loading: true })).toBe(false));
  it('hides the row without onCreate', () => expect(canCreateOption(0, 'abc', { ...on, enabled: false })).toBe(false));
  it('hides the row without search', () => expect(canCreateOption(0, 'abc', { ...on, showSearch: false })).toBe(false));
});
