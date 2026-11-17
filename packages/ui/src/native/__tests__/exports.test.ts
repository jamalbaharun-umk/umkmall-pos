/**
 * The native entry's component exports, ENUMERATED.
 *
 * UMK-915's mechanism: a test that maps over the exports and checks each has a playbook
 * entry passes trivially when an export is missing from both sides; a hard-coded list fails
 * when the library grows and forces someone to look. This is the library half of that pair.
 * The playbook half (`apps/mobile/src/playbook/__tests__/components.test.tsx`) holds the SAME
 * list, and the two are kept equal by hand — deliberately, because `turbo`'s `test` task
 * caches per package and a guard sited in `apps/mobile` would replay a cached pass over a
 * new export here. So a new sibling reddens THIS file first, and the fix is to add it to
 * both lists and to the playbook.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * SOURCE-SCANNED, not imported: `react-native` does not load under vitest/happy-dom (its
 * entry is Flow), so the entry file is read as text and its `export { … } from` clauses
 * parsed. That also means a broken component compiles nothing here — `tsc` and the mobile
 * Jest suite are what exercise the code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENTRY = resolve(__dirname, '..', 'index.ts');

/**
 * Every component (a capitalised value export) the native entry publishes. Types, the
 * token bridge and the field helpers are not components and are not counted.
 *
 * ORDER MATTERS: this is compared by `toEqual`, so a reorder is a diff someone reads.
 */
export const NATIVE_COMPONENTS = [
  'Text',
  'Icon',
  'Spinner',
  'Button',
  'TextField',
  'CheckBox',
  'Radio',
  'Switch',
  'Slider',
  'Alert',
  'Toaster',
  'Skeleton',
  'Badge',
  'Chip',
  'Card',
  'Tabs',
  'TabsList',
  'TabsTrigger',
  'TabsContent',
  'List',
  'Disclosure',
  'Image',
  'Divider',
  'Dialog',
  'Menu',
  'Label',
  'ProgressBar',
  'CodeBlock',
  'Stepper',
  'SelectionCard',
  'Select',
  'Upload',
  'DateTimeInput',
  'Lightbox',
  'ChatToolsButton',
  'ChatAttachmentButton',
  'ChatVoiceButton',
  'ChatSendButton',
  'ChatAttachment',
  'ChatComposer',
  'ChatComposerInput',
  'ChatDrawer',
  'ChatSoundWave',
  'ChatVoiceBar',
  'ChatMessageTTSButton',
  'ChatMessage',
  'ChatMessageBubble',
  'ChatMessageMetadata',
  'ChatMessageList',
  'ChatThread',
  'ChatScrollButton',
  'Avatar',
  'ListGroup',
  'ListRow',
  'TabBar',
  'IconButton',
  'FeatureTile',
  'PhotoCard',
  'CoinChip',
  'ProfileHeader',
  'Pagination',
  'MonthCalendar',
] as const;

/** Value exports that are deliberately NOT components and NOT playbook entries. */
const NON_COMPONENT_VALUES = new Set([
  'ICON_NAMES',
  'ICON_REGISTRY',
  'PORTED_ICON_NAMES',
  'toast',
  'FONT_FAMILY_BY_WEIGHT',
  'ICON_COLOR_VALUES',
  'TEXT_COLOR_VALUES',
  'TEXT_COLORS',
  'measure',
  'resolveTextStyle',
  'shadowStyle',
  'withAlpha',
  'tokens',
  'FieldError',
  'FieldLabel',
  'RequiredMark',
  'useFieldIds',
  /* A paint helper (UMK-1128): no contract entry, no playbook page — `Badge` is where it shows. */
  'GradientFill',
  /* Motion helpers (native-ui-v2): behaviour every v2 component wears, not components. */
  /* The token easings as `Animated` easing functions — for a view whose motion is not one of the
     helpers (the OTP boxes' crossfade and shake, UMK-1487) and must not parse the bezier itself. */
  'EASING',
  'Enter',
  'EnterList',
  'MOTION',
  'PressableScale',
  /* The paint-on-the-host sibling, for an app control whose Pressable is itself the flex child
     (the composer's ratio chip shrinks by its own style, which `PressableScale` would move inside). */
  'PressableScaleHost',
  'parseCubicBezier',
  'staggerDelay',
  'useReducedMotion',
  /* The reader's text size (UMK-1832): a context provider with no look of its own, its hook and its table. */
  'TextScaleProvider',
  'useTextScale',
  'TEXT_SIZES',
  'TEXT_SIZE_SCALE',
  'DEFAULT_TEXT_SIZE',
  'isTextSize',
  'scaleTextStyle',
  /* Haptics (UMK-1602): a fire-and-forget function, not a component. */
  'haptic',
  /* The expo-router adapter for `TabBar` (native-ui-v2): a render-prop factory, not a component. */
  'navigatorTabBar',
  /* `TabBar`'s height, for a host's bottom clearance: a number, not a component. */
  'TAB_BAR_HEIGHT',
]);

/** Parses `export { a, type B, c as d } from '…'` into the VALUE names it publishes. */
const valueExports = (source: string): string[] => {
  const names: string[] = [];
  for (const m of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const entry = raw.trim();
      if (!entry || entry.startsWith('type ')) continue;
      names.push(entry.split(/\s+as\s+/).pop()!.trim());
    }
  }
  return names;
};

describe('@umkmall/ui/native exports', () => {
  const source = readFileSync(ENTRY, 'utf8');
  const values = valueExports(source);

  it('parses the entry, so the assertions below are not vacuous', () => {
    expect(values.length).toBeGreaterThan(10);
  });

  it('publishes exactly the enumerated components, in order', () => {
    const components = values.filter((n) => !NON_COMPONENT_VALUES.has(n));
    expect(components).toEqual([...NATIVE_COMPONENTS]);
  });

  // The count, asserted as a literal rather than derived from the list above. A number that
  // moves for good reasons is exactly the kind someone stops checking — so it is written
  // down where a diff shows it changing.
  it('has 62 components', () => {
    expect(NATIVE_COMPONENTS).toHaveLength(62);
  });

  it('names every non-component value export, so a new helper cannot masquerade as a component', () => {
    for (const name of NON_COMPONENT_VALUES) {
      expect(values, `${name} is listed as a non-component but is not exported`).toContain(name);
    }
  });
});
