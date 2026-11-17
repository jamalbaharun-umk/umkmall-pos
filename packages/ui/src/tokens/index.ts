/**
 * Design Tokens
 *
 * Generated from the Ensyra — DS Figma export by `npm run tokens:build`.
 * The shape mirrors how the design system is organised, so it reads the same
 * here and in Expo.
 *
 * @example
 * ```typescript
 * import { tokens } from '@umkmall/ui/tokens'
 *
 * const brand = tokens.surface.default.brand
 * ```
 */

export * from './generated';


/**
 * The Foundation page mapping, shared so the web Storybook (apps/design) and the native
 * playbook cannot drift. Both call `groupsForPage`; neither restates it. That is what makes
 * a page-for-page visual comparison between the two meaningful rather than a coincidence.
 *
 * Safe on this path: it imports `./generated` and nothing platform-bound.
 */
export * from './foundation-pages';
