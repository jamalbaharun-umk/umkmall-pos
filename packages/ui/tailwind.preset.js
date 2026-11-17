/**
 * UMKMall UI Tailwind Preset
 *
 * Shared Tailwind configuration for the design system.
 * Import this preset in your application's tailwind.config.js
 *
 * @example
 * ```js
 * // tailwind.config.js
 * import uiPreset from '@umkmall/ui/tailwind-preset'
 *
 * export default {
 *   presets: [uiPreset],
 *   content: [
 *     './app/**\/*.{ts,tsx}',
 *     './node_modules/@umkmall/ui/**\/*.{ts,tsx}',
 *   ],
 * }
 * ```
 */

/**
 * The colour, radius and spacing scales in `generated` come from `npm run tokens:build`.
 * Everything written out below is hand-kept, and the generated theme is merged ON TOP of
 * it — see the deep merge at the bottom. So on a leaf collision the GENERATED value wins;
 * a hand-kept leaf only survives where the generated theme has no counterpart.
 */
const generated = require('./tokens.preset.js');

/** @type {import('tailwindcss').Config} */
const preset = {
  theme: {
    screens: {
      sm: '480px',
      md: '768px',
      lg: '976px',
      xl: '1440px',
      xxl: '2560px',
      xxxl: '7680px',
    },
    extend: {
      // Font Family
      fontFamily: {
        sans: ['var(--font-be-vietnam-pro)', 'Be Vietnam Pro', 'sans-serif'],
      },

      // The three shadow composites the token build publishes as `--shadow-*` (UMK-1333).
      // The build emits no utility for them, and `shadow-<colour>` is deliberately absent.
      boxShadow: {
        '5-pct': 'var(--shadow-5-pct)',
        card: 'var(--shadow-card)',
        '10-pct': 'var(--shadow-10-pct)',
      },

      // Colors from design tokens
      colors: {
        // Brand colors
        z: {
          primary: '#0074E7',
          lightGray: '#F7F7F7',
          text: {
            primary: '#1C1B1F',
            gray: '#9F9F9F',
          },
        },
        // New semantic color structure
        brand: {
          primary: '#0074E7',
        },
        background: {
          primary: '#FFFFFF',
          secondary: '#F7F7F7',
        },
        // Only `inverse` is hand-kept: the generated theme supplies its own
        // `text.primary` / `text.secondary`, and generated wins a leaf collision — so a
        // hand-kept copy here would never take effect while still reading as authoritative.
        text: {
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E0E0E0',
          light: '#F7F7F7',
          focus: '#0074E7',
          /**
           * HAND-KEPT BECAUSE THE GENERATED GROUP HAS NO `secondary` LEAF, so this survives
           * the deep merge below rather than losing to it.
           *
           * Figma's `01 Mark` strokes its default step in `#93a2b0`, and that hex is published
           * only as `text.secondary` / `icon.secondary` — nothing in the `border` group
           * resolves to it. The purge guard rejects a raw hex and a raw palette class alike,
           * so without this token the ring has no sayable class at all.
           */
          secondary: '#93A2B0',
        },
        state: {
          success: '#10B981',
          error: '#EF4444',
          warning: '#F59E0B',
          info: '#3B82F6',
        },
      },

      /**
       * A 3px stroke, because Figma's `01 Mark` draws one and Tailwind's default scale does
       * not carry it (0/2/4/8 plus DEFAULT 1).
       *
       * NOT `border-[3px]`. Every purge guard filters arbitrary values out of its own
       * coverage, so the one class this turns on would be excluded from the check that it
       * survives the purge. A scale entry is checked; a bracket is not.
       *
       * Hand-kept here rather than in `tokens.preset.js`, which is generated — and neither
       * preset defines a `borderWidth` key, so this survives the merge.
       */
      borderWidth: {
        3: '3px',
        /**
         * The slider thumb's ring. Figma's `Slider` 1308:8026 draws both thumbs as a white
         * disc with a 6px brand stroke, and Tailwind's default scale stops at 8. Same
         * reasoning as the 3 above: a scale entry is checked by the purge guards, a
         * `border-[6px]` bracket is filtered out of their coverage.
         */
        6: '6px',
      },

      // Font Sizes from design tokens
      fontSize: {
        /**
         * UMK-1325: sizes the Figma type scale has no token for, spelled exactly as the Tailwind
         * defaults they replace (same px, same line-height) but through `--ds-text-scale` so they
         * scale with the text-size setting. Hand-kept; a real token replaces each when design
         * publishes one. `ds-` prefix so `cn()` reads them as font sizes, not colours.
         */
        'ds-legacy-xs': ['calc(0.75rem * var(--ds-text-scale, 1))', { lineHeight: 'calc(1rem * var(--ds-text-scale, 1))' }],
        'ds-legacy-3xl': ['calc(1.875rem * var(--ds-text-scale, 1))', { lineHeight: 'calc(2.25rem * var(--ds-text-scale, 1))' }],
        // 10px / 11px badges: size only, they inherit their line-height.
        'ds-legacy-10': 'calc(0.625rem * var(--ds-text-scale, 1))',
        'ds-legacy-11': 'calc(0.6875rem * var(--ds-text-scale, 1))',
        '1.5xl': '22px',
        '4xl': '33px',
        '9': '9px',
      },

      /**
       * The skeleton shimmer.
       *
       * NAMESPACED on purpose. `apps/main-website` presets this file AND defines its own
       * `shimmer` keyframe; Tailwind's `extend` merge lets the consuming config win on a
       * same-named key, so an entry called `shimmer` here would be shadowed there and the
       * same `Skeleton` would animate one way in the app and another in Storybook, with
       * nothing red. `ds-shimmer` cannot collide.
       *
       * Reduced motion is the COMPONENT's job, not this one's: a `motion-reduce:` variant
       * on the element is what turns the placeholder static, because a keyframe that stops
       * itself would freeze mid-sweep at whatever opacity it happened to reach.
       */
      keyframes: {
        'ds-shimmer': {
          '100%': { transform: 'translateX(100%)' },
        },
        /**
         * The voice bar's five bars, each scaling on its own delay.
         *
         * SCALE ONLY, never height: animating `height` reflows the row on every frame, and the
         * bar sits inside a flex line whose other children would be measured against it. The
         * stagger is NOT here — one keyframe set with five `animation-delay` values is what makes
         * a waveform out of a single rule, and the delay is per element.
         *
         * `ds-` prefixed for `ds-shimmer`'s reason: the app defines its own `soundWave` keyframes
         * inline today, and an unprefixed name would collide with them silently once the
         * component is adopted — the same bars animating from whichever rule the cascade landed
         * on, with nothing red.
         */
        'ds-soundwave': {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'ds-shimmer': 'ds-shimmer 1.6s infinite',
        'ds-soundwave': 'ds-soundwave 0.5s ease-in-out infinite',
      },

      // Spacing from design tokens
      padding: {
        'z-50': '50px',
        'z-100': '100px',
        'z-115': '115px',
        'z-150': '150px',
      },
      spacing: {
        /**
         * 18px. Tailwind's default scale jumps 16 → 20 (`4` → `5`) and has no `4.5`, but
         * Figma uses 18px twice: the small slider thumb (`Slider` 1308:8026) and the large
         * checkbox/radio box (`01 Check Box` 121:1457). 16px and 14px are already on the
         * scale as `4` and `3.5`, so this is the only step missing.
         *
         * A named entry rather than `h-[18px]`, for the same reason the 3px border width is
         * — every purge guard filters arbitrary values out of its own coverage.
         */
        4.5: '18px',
        'z-50': '50px',
        'z-100': '100px',
        'z-115': '115px',
        'z-150': '150px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

/**
 * Deep-merge, never replace. The generated theme adds `surface`/`text`/`icon`/
 * `border`/`callout`/`composer`; the hand-kept object above still carries the `z`
 * group, which has 132 uses app-wide. Tailwind emits nothing for an unknown
 * utility, so a replace would drop their colour with no build error at all.
 */
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
        ? merge(out[k], v)
        : v;
  }
  return out;
};

preset.theme.extend = merge(preset.theme.extend, generated.theme.extend);

module.exports = preset;
