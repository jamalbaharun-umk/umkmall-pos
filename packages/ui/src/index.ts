/**
 * UMKMall UI Design System
 *
 * A comprehensive design system for UMKMall applications.
 * Built with React, TypeScript, Tailwind CSS, and CVA.
 *
 * @example
 * ```typescript
 * // Import primitives
 * import { Button, Text } from '@umkmall/ui'
 *
 * // Import tokens
 * import { tokens } from '@umkmall/ui/tokens'
 *
 * // Import utils
 * import { cn } from '@umkmall/ui/utils'
 * ```
 */

// Export the variant contract — the vocabulary slices 2-5 build against
export * from './contract';

// Export all primitives
export * from './primitives';

// Export all compositions
export * from './compositions';

/* Export the layout frames. This line is the KTD16 decision: `Sidebar` and `Header` are
   reachable from the root through `primitives`, so a shell that composes them but is reachable
   only through `@umkmall/ui/layouts` is an asymmetry a caller meets as an error rather than as
   a decision. The subpath stays published and keeps working; see `layouts/index.ts`. */
export * from './layouts';

// Export design tokens
export * from './tokens';

// Export utilities
export * from './utils';

// Export web-only hooks (not re-exported by the native entry)
export * from './hooks';

// Export commonly used components for convenience
export { Button, type ButtonProps } from './primitives/Button';
export { Alert, type AlertProps } from './primitives/Alert';
export { Badge, type BadgeProps } from './primitives/Badge';

// Export commonly used utilities
export { cn } from './utils/cn';
export type { PolymorphicComponentProps, PolymorphicComponentPropsWithRef } from './utils/polymorphic';

