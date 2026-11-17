/**
 * Which native components actually IMPLEMENT an interaction treatment (UMK-914).
 *
 * The playbook is the sign-off surface: a treatment nobody has rendered on a device is a
 * treatment nobody has approved. `apps/mobile/src/playbook/__tests__/components.test.tsx`
 * demands a fixture for every component named here, and derives the same two sets from the
 * same sources — so the two guards agree by construction rather than by hand.
 *
 * THIS half exists because of the turbo caching rule: `test` is cached per package with no
 * `dependsOn`, so a guard sited in `apps/mobile` replays a cached PASS when the change is in
 * `packages/ui`. Give `Tabs`' trigger a pressed branch and the mobile guard may never run;
 * this file runs, reddens, and sends the author to the playbook.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * SOURCE-SCANNED, not imported: `react-native` does not load under vitest (its entry is
 * Flow), so the components are read as text — the same trick `exports.test.ts` uses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const NATIVE_DIR = resolve(__dirname, '..');

/**
 * A `Pressable` hands `pressed` to a style or children callback and nowhere else, so a
 * component that destructures it in a parameter position is a component with a pressed
 * treatment. Matching the DESTRUCTURE rather than the word keeps prose and prop names
 * (`pressedBg`, "a chip is pressed") out of the result.
 */
const PRESSED_CALLBACK = /\(\{\s*pressed\s*[,}]/;

/** The focus pair is published once, in `field-styles.ts`; reading it is the treatment. */
const FOCUS_RING_USE = /\bFOCUS_RING\b/;

interface Source {
  name: string;
  text: string;
}

/** A capitalised `.tsx` sibling is a component; `field-support.tsx` is the helper module. */
const componentSources = (): Source[] =>
  readdirSync(NATIVE_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx') && /^[A-Z]/.test(e.name))
    .map((e) => ({ name: e.name.replace(/\.tsx$/, ''), text: readFileSync(resolve(NATIVE_DIR, e.name), 'utf8') }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const owners = (sources: Source[], pattern: RegExp): string[] =>
  sources.filter((s) => pattern.test(s.text)).map((s) => s.name);

/**
 * The components with a pressed treatment, ENUMERATED.
 *
 * `Tabs`' trigger and `Disclosure`'s header are pressable and have NO pressed branch —
 * absent from this list on purpose, and the day either gains one this test is what says so.
 * `ChatVoiceBar`'s stop and `ChatMessageTTSButton` join them: both draw a filled or tinted
 * state the row already reads as engaged, and a press tint under it would be a second signal
 * for the same fact. Same rule, same list, and the same test says so if either gains one.
 *
 * `ChatScrollButton` IS on it (UMK-1129): the web pill lightens to the neutral hover surface
 * under a pointer, and `pressed` stands where the web has `hover` — the rule `Button` follows.
 * The rest of the message family draws no pressed treatment: rows, bubbles and metadata take no
 * touch, and the list and the frame are containers.
 *
 * `ListRow` (native-ui-v2) IS on it: a pressed row tints `surface.weak.brand`. The press MOTION
 * that `Button`, `Chip`, `SelectionCard` and `ListRow` wear (`PressableScaleHost`) is not a pressed
 * treatment in this sense — it is a scale, not a paint — so `SelectionCard` stays off this list.
 */
const PRESSED = ['Button', 'ChatScrollButton', 'CheckBox', 'Chip', 'ListRow', 'Menu', 'Radio'] as const;

/** The components with a focus treatment. `TextField` is the only control that takes focus. */
const FOCUSED = ['TextField'] as const;

describe('native interaction treatments', () => {
  const sources = componentSources();

  /**
   * The scan's own floor, sized to a PARTIAL failure rather than a total one (UMK-958).
   * `readdirSync` returning nothing would be caught by any assertion below; the failure
   * that would NOT be caught is a scan that quietly reads a subset — an extension filter
   * that stops matching, a directory read that lands one level up. There are 59 component
   * files behind 62 exports (`Tabs` carries four of them), so the floor is the real count,
   * not a token `> 0`. 57 since native-ui-v2 (`MeshBackground`, `Avatar`, `ListGroup`, `ListRow`, `TabBar`, `IconButton`, `FeatureTile`, `PhotoCard`, `CoinChip`); 58 with `ProfileHeader` (UMK-1601); 59 with `Pagination` (UMK-1601); 58 again with `MeshBackground` deleted (UMK-1603); 59 with `MonthCalendar` (UMK-1358).
   */
  it('reads every component file, so nothing below is vacuous', () => {
    expect(sources.length).toBe(59);
    /* 200, not 500. The floor exists to catch a read that returns NOTHING, and the four
       composer buttons are legitimately ~460 bytes each: they delegate everything to
       `composer-button.tsx`, which is lowercase and so not a component file. A floor sized to
       the biggest components would red on a small one that is perfectly real. */
    expect(sources.every((s) => s.text.length > 200)).toBe(true);
  });

  it('names exactly the components with a pressed treatment', () => {
    expect(owners(sources, PRESSED_CALLBACK)).toEqual([...PRESSED]);
  });

  it('names exactly the components with a focus treatment', () => {
    expect(owners(sources, FOCUS_RING_USE)).toEqual([...FOCUSED]);
  });

  /**
   * Per contributor, so ONE component losing its treatment names that component rather than
   * printing a set diff the reader has to subtract by eye (UMK-956).
   */
  it.each(PRESSED)('%s still implements a pressed treatment', (name) => {
    const source = sources.find((s) => s.name === name);
    expect(source, `${name}.tsx was not scanned`).toBeDefined();
    expect(PRESSED_CALLBACK.test(source!.text)).toBe(true);
  });

  it.each(FOCUSED)('%s still implements a focus treatment', (name) => {
    const source = sources.find((s) => s.name === name);
    expect(source, `${name}.tsx was not scanned`).toBeDefined();
    expect(FOCUS_RING_USE.test(source!.text)).toBe(true);
  });

  /**
   * `Menu` builds its rows itself, so it is the one component whose pressed treatment is
   * unreachable from outside without a forwarded prop. If that forward is dropped the
   * playbook's Menu specimen renders a plain row and NOTHING else fails — the fixture is
   * still there, the render still succeeds, the treatment is just never armed.
   */
  /**
   * `ListRow`'s plain variant (UMK-1601) fades its tint in on a layer instead of painting the
   * pressable, so the pressed callback above stays the one signal: the layer must be armed by
   * the SAME `pressed` (and `testOnly_pressed`, which the host folds into it), or a plain row
   * held pressed in the playbook shows nothing while this file stays green.
   */
  it("arms ListRow's plain highlight from the same pressed state as the tile row's tint", () => {
    const row = sources.find((s) => s.name === 'ListRow')!.text;
    expect(row).toMatch(/const isLit = \(pressed: boolean\) => active \|\| \(pressed && !disabled\);/);
    expect(row).toMatch(/<PlainRowBody[\s\S]*?lit=\{isLit\(pressed\)\}/);
    expect(row).toMatch(/!plain && isLit\(pressed\) && ROW_TINTED/);
  });

  it('forwards testOnly_pressed to the menu row, or the Menu specimen is a lie', () => {
    const menu = sources.find((s) => s.name === 'Menu')!.text;
    expect(menu).toMatch(/testOnly_pressed\?:\s*boolean/);
    expect(menu).toMatch(/testOnly_pressed=\{testOnly_pressed\}/);
  });
});
