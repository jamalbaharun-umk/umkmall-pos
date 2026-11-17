import React from 'react';

/**
 * Polymorphic Component Types
 *
 * These types enable components to accept an `as` prop to change their underlying element.
 * This is useful for semantic HTML and accessibility while maintaining component styling.
 *
 * @example
 * ```typescript
 * type ButtonProps<C extends React.ElementType = 'button'> = PolymorphicComponentProps<
 *   C,
 *   {
 *     variant?: 'primary' | 'secondary'
 *   }
 * >
 *
 * function Button<C extends React.ElementType = 'button'>({
 *   as,
 *   variant = 'primary',
 *   ...props
 * }: ButtonProps<C>) {
 *   const Component = as || 'button'
 *   return <Component {...props} />
 * }
 *
 * // Usage:
 * <Button>Click me</Button> // renders <button>
 * <Button as="a" href="/link">Link button</Button> // renders <a>
 * ```
 */

/**
 * Props for a polymorphic component
 */
export type PolymorphicComponentProps<
  C extends React.ElementType,
  Props = Record<string, unknown>
> = Props &
  Omit<React.ComponentPropsWithoutRef<C>, keyof Props> & {
    as?: C;
  };

/**
 * Props for a polymorphic component with ref support
 */
export type PolymorphicComponentPropsWithRef<
  C extends React.ElementType,
  Props = Record<string, unknown>
> = PolymorphicComponentProps<C, Props> & {
  ref?: PolymorphicRef<C>;
};

/**
 * Ref type for a polymorphic component
 */
export type PolymorphicRef<C extends React.ElementType> = React.ComponentPropsWithRef<C>['ref'];
