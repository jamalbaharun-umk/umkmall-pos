/**
 * The one page-strip rule `Pagination` uses on both platforms.
 *
 * Moved here from `primitives/Pagination/page-items.ts` when native grew a pager (UMK-1601): the web
 * file sits beside a component that imports React and the class tables, so `@umkmall/ui/native`
 * cannot reach it, and a second native strip would agree with the web's only until one was edited.
 * The web module re-exports this one. This module imports NOTHING.
 *
 * First, last, current and its neighbours, with an ellipsis over every gap. This is Figma's
 * `Page: <9 | >9` pair, derived from `pageCount` rather than chosen by the caller.
 */
export const pageItems = (current: number, total: number): Array<number | 'ellipsis'> => {
  const wanted = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: Array<number | 'ellipsis'> = [];
  wanted.forEach((p, i) => {
    /* A gap of exactly one page shows that page: an ellipsis would take the same slot and hide it. */
    if (i > 0 && p - wanted[i - 1] === 2) out.push(p - 1);
    else if (i > 0 && p - wanted[i - 1] > 2) out.push('ellipsis');
    out.push(p);
  });
  return out;
};
