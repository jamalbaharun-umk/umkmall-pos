/* The rule lives in `shared/` so the native pager draws the same strip (UMK-1601). Kept as its own
   module here, not re-exported from `Pagination.tsx`: a second value export in a component's file
   zeroes its docgen props (apps/design/docgen.test.ts, UMK-1184). */
export { pageItems } from '../../shared/page-items';
