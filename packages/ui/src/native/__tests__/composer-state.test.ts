/**
 * THE NATIVE COMPOSER TOGGLES TAKE THE CONTRACT'S `state` AXIS, AND NOTHING ELSE (UMK-1128).
 *
 * `ChatToolsButton`, `ChatAttachmentButton` and `ChatVoiceButton` declare
 * `state: ['default', 'active']`. The web read it since UMK-900; the native siblings took an
 * `active` BOOLEAN, which covers the same two drawings without reading the vocabulary — so the
 * day the contract grows a third value, native compiles, renders the default, and says nothing.
 * `contract/native-parity.test.ts` now sees the axis in each wrapper. What it CANNOT see is the
 * rest of this file:
 *
 * - it accepts `Of<'x'>`/`Axes['x']` in the file and does not ask WHICH entry `Axes` came from,
 *   so a wrapper typing itself off a sibling's entry passes it;
 * - it says nothing about a second, boolean way to reach the same state surviving beside the
 *   axis — two APIs for one fact, which is what this ticket removed;
 * - and it never opens `composer-button.tsx`, where the axis actually decides the drawing.
 *
 * SOURCE-SCANNED, not rendered: `react-native` does not load under vitest (its entry is Flow),
 * the same reason `press-states.test.ts` and `disabled-keeps-state.test.ts` read text. Sited in
 * `packages/ui`, not `apps/mobile`, because turbo caches `test` per package and a guard there
 * would replay a cached pass over a change here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * PROVED RED, one injection each (`vitest run src/native/__tests__/composer-state.test.ts`):
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `ChatVoiceButton` dropped from `TOGGLES` below | 1 — the list matches the contract |
 * | `ChatVoiceButton.tsx` types `Axes` off `contract.ChatToolsButton.axes` | 1 — voice reads its own entry |
 * | `ChatAttachmentButton.tsx` declares `state?: 'default' \| 'active'` by hand | 1 — attachment reads its own entry |
 * | `active?: boolean;` restored to `ComposerButtonProps` | 1 — no boolean beside the axis |
 * | `isOpen?: boolean;` added to `ComposerButtonProps` (a renamed boolean) | 1 — no boolean beside the axis |
 * | `active = false,` restored to the base's destructure | 1 — the base destructures no boolean |
 * | `const active = Boolean(props.accessibilityState?.selected);` in the base | 1 — engaged only from the axis |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';

const NATIVE_DIR = resolve(__dirname, '..');

/**
 * Comments stripped, line comments FIRST — a line comment may hold the two characters that open
 * a block comment, and stripping blocks first lets that swallow the file to the next close.
 * See docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md
 */
const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (file: string) => code(readFileSync(resolve(NATIVE_DIR, file), 'utf8'));

/** The three toggles — every contract entry in the family whose `state` is `default | active`. */
const TOGGLES = ['ChatToolsButton', 'ChatAttachmentButton', 'ChatVoiceButton'] as const;

const BASE = read('composer-button.tsx');

/** The body of one `interface X … { … }`, assuming no nested braces — true of these props. */
const interfaceBody = (src: string, name: string): string | undefined =>
  new RegExp(`export interface ${name}\\b[^{]*\\{([^}]*)\\}`).exec(src)?.[1];

describe('the native composer toggles read the state axis', () => {
  /**
   * The list is DERIVED from the contract here and compared with the enumerated one, so a fourth
   * toggle added to the family reds this rather than going unguarded.
   */
  it('covers every composer entry whose state is the two-value toggle', () => {
    const fromContract = Object.entries(contract)
      .filter(([, e]) => e.family === 'composer' && JSON.stringify(e.axes.state) === '["default","active"]')
      .map(([name]) => name)
      .sort();
    expect(fromContract).toEqual([...TOGGLES].sort());
  });

  it.each(TOGGLES)('%s types its state from its OWN contract entry', (name) => {
    const src = read(`${name}.tsx`);
    /* Floor: a read that returned a stub would make the absence checks below vacuous. */
    expect(src.length, `${name}.tsx read suspiciously short`).toBeGreaterThan(300);
    expect(src, `${name} does not derive its axes from contract.${name}`).toMatch(
      new RegExp(`type Axes = typeof contract\\.${name}\\.axes;`),
    );
    const props = interfaceBody(src, `${name}Props`);
    expect(props, `${name}.tsx declares no ${name}Props interface`).toBeTypeOf('string');
    expect(props, `${name}Props does not type state off the axis`).toMatch(/\bstate\?:\s*Axes\['state'\]\[number\];/);
  });

  /**
   * ONE API. The intent is "no boolean way to reach the engaged drawing", so this counts EVERY
   * boolean member of the shared props rather than banning one spelling of `active` — a renamed
   * `isOpen?: boolean` is the same second API. `disabled` is the one boolean that belongs: it is
   * an ordinary control property, not a drawing the axis owns.
   * See docs/solutions/conventions/an-injection-proof-only-proves-the-spellings-you-chose.md
   */
  it('lets the shared props carry no boolean beside the axis', () => {
    const props = interfaceBody(BASE, 'ComposerButtonProps');
    expect(props, 'composer-button.tsx declares no ComposerButtonProps interface').toBeTypeOf('string');
    const booleans = [...props!.matchAll(/(\w+)\??:\s*boolean\b/g)].map((m) => m[1]);
    expect(booleans, 'ComposerButtonProps carries a boolean state beside the contract axis').toEqual(['disabled']);
  });

  it('destructures state, and no engaged boolean, in the base', () => {
    const params = /export const ComposerButton = \(\{([^}]*)\}/.exec(BASE)?.[1];
    expect(params, 'could not read the base component parameters').toBeTypeOf('string');
    const names = params!.split(',').map((p) => p.trim().split(/\s|=/)[0]).filter(Boolean);
    expect(names).toContain('state');
    expect(names.filter((n) => /^(active|isActive|engaged|open|isOpen|selected|pressed)$/.test(n))).toEqual([]);
  });

  /**
   * The drawing's one input. The glyph, the fill and `accessibilityState.selected` all read
   * `active`, so the only thing that may produce it is the axis — anything else is a second way
   * in that a caller or a later refactor can reach without the contract.
   */
  it('derives the engaged state only from the axis', () => {
    const producers = [...BASE.matchAll(/\bconst active\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(producers).toEqual(["state === 'active'"]);
  });
});
