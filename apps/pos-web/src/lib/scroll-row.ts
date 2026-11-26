/**
 * A row of tabs or segments that keeps ONE line at any width (guideline: labels never wrap). Too wide for a phone, the
 * row scrolls sideways instead of wrapping; each item keeps its natural width. `[&>*]:` styles the direct children, so
 * it works on `@umkmall/ui`'s SegmentedControl and TabsList without editing the package.
 */
export const SCROLL_ROW = 'max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:grow-0 [&>*]:basis-auto [&>*]:whitespace-nowrap'
/** The tab list's variant: its triggers stretch (`flex-1`) by default, so they need the reset above plus gaps. */
export const SCROLL_TABS = `${SCROLL_ROW} gap-1 [&>*]:px-4`
