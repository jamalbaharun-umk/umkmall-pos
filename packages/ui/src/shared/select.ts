/**
 * The one filtering rule `Select` uses on both platforms.
 *
 * Extracted for the same reason as `splitDescription` next door: the web component that owned
 * it imports React and the class tables, so `@umkmall/ui/native` cannot reach it, and a second
 * native implementation of a rule this specific would agree with the first only until someone
 * edited one. This module imports NOTHING.
 */

export interface SelectFilterOption {
  label: string;
  /** Secondary text — a city's province, a plan's price. */
  hint?: string;
}

/**
 * Narrow `options` to what a query matches, or hand them back untouched.
 *
 * A CALLER THAT OWNS THE SEARCH OWNS ALL OF IT. When `callerFilters` is true the options have
 * already been narrowed — often by a server matching on more than the label — so filtering
 * them again here would silently drop rows it deliberately returned. One flag decides both
 * halves: a component that also filtered a remotely-searched list is the half-filtering
 * failure the web's own docblock warns about.
 *
 * THE HINT IS SEARCHED ALONGSIDE THE LABEL. A hint the user can see but cannot type is a
 * trap: two cities of the same name are told apart only by their province, so filtering that
 * ignores it makes them indistinguishable in exactly the case the hint exists for.
 */
export const filterSelectOptions = <T extends SelectFilterOption>(
  options: readonly T[],
  query: string,
  { showSearch, callerFilters }: { showSearch?: boolean; callerFilters?: boolean },
): readonly T[] => {
  if (callerFilters || !showSearch || !query) return options;
  const q = query.toLowerCase();
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
  );
};

/**
 * Whether a searchable `Select` offers `Tambah "<query>"` (UMK-1119). One rule, both platforms.
 *
 * ONLY WHEN NOTHING MATCHES: `visibleCount` is what the list is about to render, so the rule
 * holds unchanged for caller-owned search, where `options` arrive already filtered.
 * NEVER WHILE LOADING: with `onSearch` the list is stale until results land, and the row would
 * flash in front of a match that is one response away.
 * TRIMMED, because the trimmed query is what `onCreate` receives.
 */
export const canCreateOption = (
  visibleCount: number,
  query: string,
  { enabled, showSearch, loading, minLength = 3 }: { enabled: boolean; showSearch?: boolean; loading?: boolean; minLength?: number },
): boolean => enabled && Boolean(showSearch) && !loading && visibleCount === 0 && query.trim().length >= minLength;
