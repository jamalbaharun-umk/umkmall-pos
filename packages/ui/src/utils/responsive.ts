/**
 * Responsive Utilities
 *
 * Helpers for working with responsive design in the UMKMall design system.
 */

/**
 * Breakpoint values matching Tailwind configuration
 */
export const breakpoints = {
  sm: 480,
  md: 768,
  lg: 976,
  xl: 1440,
  xxl: 2560,
  xxxl: 7680,
} as const;

/**
 * Type for breakpoint keys
 */
export type Breakpoint = keyof typeof breakpoints;

/**
 * Responsive value type
 * Can be a single value or an object with breakpoint-specific values
 */
export type ResponsiveValue<T> = T | Partial<Record<Breakpoint, T>>;

/**
 * Checks if a value is a responsive object
 */
export function isResponsiveValue<T>(value: ResponsiveValue<T>): value is Partial<Record<Breakpoint, T>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Gets the value for the current breakpoint
 * Falls back to smaller breakpoints if the current one is not defined
 *
 * @param value - The responsive value
 * @param currentBreakpoint - The current breakpoint
 * @returns The value for the current breakpoint
 *
 * @example
 * ```typescript
 * const padding = { sm: '8px', lg: '16px' }
 * getResponsiveValue(padding, 'md') // => '8px' (falls back to sm)
 * getResponsiveValue(padding, 'lg') // => '16px'
 * getResponsiveValue('24px', 'lg') // => '24px'
 * ```
 */
export function getResponsiveValue<T>(value: ResponsiveValue<T>, currentBreakpoint: Breakpoint): T | undefined {
  if (!isResponsiveValue(value)) {
    return value;
  }

  const breakpointOrder: Breakpoint[] = ['sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'];
  const currentIndex = breakpointOrder.indexOf(currentBreakpoint);

  // Find the closest defined value at or below the current breakpoint
  for (let i = currentIndex; i >= 0; i--) {
    const bp = breakpointOrder[i];
    if (value[bp] !== undefined) {
      return value[bp];
    }
  }

  return undefined;
}

/**
 * Converts a responsive value to Tailwind classes
 *
 * @param value - The responsive value
 * @param getClass - Function to convert a value to a class name
 * @returns Space-separated Tailwind classes
 *
 * @example
 * ```typescript
 * const padding = { sm: '8px', lg: '16px' }
 * responsiveClasses(padding, (val) => `p-[${val}]`)
 * // => 'sm:p-[8px] lg:p-[16px]'
 * ```
 */
export function responsiveClasses<T>(
  value: ResponsiveValue<T>,
  getClass: (value: T) => string
): string {
  if (!isResponsiveValue(value)) {
    return getClass(value);
  }

  const classes: string[] = [];
  const breakpointOrder: Breakpoint[] = ['sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'];

  for (const bp of breakpointOrder) {
    if (value[bp] !== undefined) {
      const className = getClass(value[bp] as T);
      classes.push(bp === 'sm' ? className : `${bp}:${className}`);
    }
  }

  return classes.join(' ');
}
