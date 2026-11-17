/* `MenuVariant` is re-exported HERE rather than from `Menu.tsx`: a re-export of an imported
   symbol in a component's own file makes `react-docgen-typescript` report zero props, which
   published a `Menu` documenting neither of its required `trigger`/`items`. See
   `Icon/index.ts` for the full reasoning. */
export { Menu } from './Menu';
export type { MenuProps, MenuItem, MenuSide, MenuAlign } from './Menu';
export type { MenuVariant } from '../overlay-classes';
