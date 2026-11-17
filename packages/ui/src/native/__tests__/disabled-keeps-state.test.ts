/**
 * A LOCK MUST NOT ERASE A SELECTION, on the native side (UMK-1091).
 *
 * `Switch`, `CheckBox` and `Radio` each resolved a disabled treatment that won over the
 * state the control was in: the switch spelled it `isOn && !disabled`, and the two boxes let
 * a single `CONTROL_BOX_DISABLED` sit last in a style array RN resolves last-wins. In all
 * three the user was told the opposite of the control's own state, and in all three the web
 * sibling carried the same defect in a different spelling.
 *
 * WHY THIS GUARD LIVES HERE. The contract has no colour dimension, so nothing links the two
 * surfaces at compile time — fix one and the other is green and wrong, undiscoverably
 * (KTD2/KTD3). And it is sited in `packages/ui` rather than in `apps/mobile` because
 * `turbo.json`'s `test` task is cached per package with no `dependsOn`: a guard over these
 * files sited in a dependent app replays a cached PASS when the change is right here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * SOURCE-SCANNED, not rendered: `react-native` does not load under vitest (its entry is
 * Flow), so the components are read as text — the same trick `press-states.test.ts` and
 * `exports.test.ts` use. That means this checks the WIRING, never the colour; a wrong hex is
 * a look, not a test (KTD6).
 *
 * PROVED RED, one injection each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `CheckBox`'s disabled arm collapsed back to the unconditional `CONTROL_BOX_DISABLED` | 1 — CheckBox |
 * | `Radio`'s likewise | 1 — Radio |
 * | `Switch`'s track resolution keyed on `!disabled` again | 1 — Switch |
 * | `CONTROL_BOX_DISABLED_CHECKED` repointed at a `default` token | 1 — the table |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const NATIVE_DIR = resolve(__dirname, '..');

/**
 * Comments are STRIPPED, and line comments go first.
 *
 * Every rule below is a ban, so the banned shape gets quoted in the prose that explains it —
 * this file's own docblock quotes `isOn && !disabled`, and so does the note beside the fixed
 * code. Left in, a guard matches the explanation and reds on correct code, which is how the
 * first run of this file failed.
 *
 * The ORDER is the documented one: a line comment may legitimately contain the two characters
 * that open a block comment (a glob, a path), and stripping blocks first lets that swallow
 * everything up to the next close marker — 250 lines, the last time this repo was bitten.
 * See docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md
 */
const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (name: string) => code(readFileSync(resolve(NATIVE_DIR, name), 'utf8'));

describe('a disabled native control keeps the state it is in', () => {
  /**
   * The two boxes pick their disabled arm from the SAME condition that decides whether the
   * glyph is painted at all, so the fill and the tick cannot disagree. Matching the
   * conditional rather than the mere presence of the name is the point: the defect was an
   * unconditional use of it, which a presence check would have passed.
   */
  it.each([
    ['CheckBox.tsx', /disabled\s*&&\s*\(\s*isChecked\s*\|\|\s*indeterminate\s*\?\s*CONTROL_BOX_DISABLED_CHECKED\s*:\s*CONTROL_BOX_DISABLED\s*\)/],
    ['Radio.tsx', /disabled\s*&&\s*\(\s*checked\s*\?\s*CONTROL_BOX_DISABLED_CHECKED\s*:\s*CONTROL_BOX_DISABLED\s*\)/],
  ])('%s chooses its disabled fill from whether it is selected', (file, wired) => {
    const text = read(file);
    expect(text, `${file} applies one disabled fill regardless of selection`).toMatch(wired);

    /**
     * COUNTED, NOT BANNED BY SPELLING. This used to ban one idiom —
     * `disabled && CONTROL_BOX_DISABLED` — which is the spelling the defect happened to wear.
     * Review re-introduced the same defect six other ways that all passed:
     * `disabled ? CONTROL_BOX_DISABLED : null`, a hoisted `const off = disabled`,
     * a spread `...(disabled ? [CONTROL_BOX_DISABLED] : [])`, `Boolean(disabled) && …`,
     * a renamed `isDisabled && …`, and `(disabled || false) && …`. Every one leaves the
     * positive `wired` assertion above matching and appends a SECOND unconditional fill, which
     * RN's style array resolves last-wins — so the fill the user sees is the wrong one.
     *
     * What actually has to hold is not "this spelling is absent" but "the conditional arm is
     * the ONLY place the unselected fill is used". A count says that in a way no spelling can
     * evade: one reference in the whole component, and it is the one inside `wired`.
     * See docs/solutions/conventions/an-injection-proof-only-proves-the-spellings-you-chose.md
     */
    /* Imports are not uses. The name necessarily appears once in the import list; what the
       count is about is how many times it is APPLIED. */
    const body = text.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?/gm, '');
    const uses = body.match(/\bCONTROL_BOX_DISABLED\b(?!_CHECKED)/g) ?? [];
    expect(
      uses.length,
      `${file} references CONTROL_BOX_DISABLED ${uses.length} times; exactly one, inside the conditional arm, is the only safe shape — a second use is a fill RN resolves last`,
    ).toBe(1);

    /* And that single use must be the one the conditional arm owns: stripping the matched arm
       has to remove it. Otherwise the count is satisfied by a use somewhere else entirely. */
    expect(
      body.replace(wired, '').match(/\bCONTROL_BOX_DISABLED\b(?!_CHECKED)/g),
      `${file}'s only CONTROL_BOX_DISABLED reference is outside the conditional arm`,
    ).toBeNull();
  });

  /**
   * The locked-selection arm has to name DISABLE tokens. Pointing it at the default brand
   * would keep every assertion above green while painting a locked control as an active one
   * — the opposite failure, and equally invisible.
   */
  it('paints the locked-selection arm from the disable ramp', () => {
    const table = read('field-styles.ts');
    const arm = /export const CONTROL_BOX_DISABLED_CHECKED = \{([^}]*)\}/.exec(table)?.[1];
    expect(arm, 'field-styles.ts publishes no CONTROL_BOX_DISABLED_CHECKED').toBeTypeOf('string');
    expect(arm).toMatch(/borderColor:\s*tokens\.border\.disable\./);
    expect(arm).toMatch(/backgroundColor:\s*tokens\.surface\.disable\./);
    expect(arm, 'the locked arm reads a default-state token, so a locked control paints as active').not.toMatch(
      /tokens\.(border|surface)\.default\./,
    );
  });

  /**
   * The switch resolves its track from on-ness and inertness TOGETHER. `isOn && !disabled`
   * is the exact defect — it answers "off" for a switch that is on — so it is banned by
   * shape rather than the correct form merely being required.
   */
  it('resolves the switch track from both dimensions at once', () => {
    const text = read('Switch.tsx');
    expect(
      text.match(/isOn\s*&&\s*!\s*(disabled|inert|loading)/),
      'Switch still folds disabledness into on-ness, which paints a locked ON switch as OFF',
    ).toBeNull();
    /**
     * THE PAIRING, not two presences. Asserting that both tokens merely APPEAR passes just as
     * happily when they are swapped — a locked-ON switch painting the off colour and a
     * locked-OFF switch painting brand, which is the original defect wearing a new spelling.
     * The shape below pins which arm each token sits in: `inert` selects on `isOn`, brand for
     * on and primary for off.
     */
    expect(
      text.replace(/\s+/g, ' '),
      'Switch does not resolve inert-and-on to the disable BRAND fill and inert-and-off to disable primary',
    ).toMatch(
      /inert \? isOn \? tokens\.surface\.disable\.brand : tokens\.surface\.disable\.primary/,
    );
    expect(
      text.match(/opacity:\s*(disabled|inert|loading)/),
      'Switch still fades instead of taking a colour',
    ).toBeNull();
  });
});
