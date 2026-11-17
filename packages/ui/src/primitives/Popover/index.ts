export { Popover, PopoverContent } from './Popover';
export type { PopoverProps, PopoverAlign, PopoverContentProps } from './Popover';
/* Radix's own parts, re-exported HERE rather than from `Popover.tsx`: an alias of an imported
   symbol inside the component's own module cost the file its docgen entries (see `Menu/index.ts`). */
export { Trigger as PopoverTrigger, Anchor as PopoverAnchor } from '@radix-ui/react-popover';
