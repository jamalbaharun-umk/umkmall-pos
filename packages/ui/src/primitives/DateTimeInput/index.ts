export * from './DateTimeInput';
/* The value rule lives in `shared/date-input.ts` since UMK-1128 (shared with the native sibling).
   It is re-exported HERE, from the barrel, rather than from `DateTimeInput.tsx`: a re-export of
   imported bindings inside the component's own module left react-docgen-typescript reading an
   EMPTY props table for `DateTimeInput`, which `apps/design`'s `docgen.test.ts` catches. The
   public `@umkmall/ui` surface is unchanged: both helpers stay exported. */
export { formatIsoDate, parseIsoDate } from '../../shared/date-input';
