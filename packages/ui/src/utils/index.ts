/**
 * Design System Utilities
 *
 * Shared utilities for the UMKMall design system.
 * These helpers make it easier to work with components, styling, and responsive design.
 *
 * @example
 * ```typescript
 * import { cn, type PolymorphicComponentProps } from '@umkmall/ui/utils'
 * ```
 */

export * from './cn';
export * from './format-file-size';
export * from './text-color-classes';
export * from './focus-ring-classes';
export * from './focus-modality';
export * from './gradient-classes';
export * from './merge-refs';
export * from './polymorphic';
export * from './responsive';
export * from './slot';

// Re-export commonly used utilities
export { cn } from './cn';
export type { PolymorphicComponentProps, PolymorphicComponentPropsWithRef, PolymorphicRef } from './polymorphic';
export { breakpoints, isResponsiveValue, getResponsiveValue, responsiveClasses } from './responsive';
export type { Breakpoint, ResponsiveValue } from './responsive';
