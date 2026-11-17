/**
 * The native `Dialog` has NO centred form (UMK-1075).
 *
 * UMK-913 gave destructive confirmations a centred card on native; UMK-1075 retired it. On a
 * phone the native `Dialog` is always a bottom sheet, and what the card bought — no backdrop,
 * no Back, no swipe — is `dismissible={false}`. The web `Dialog` keeps its `centered`, so the
 * shared contract still declares the boolean, and native's gap is recorded on the entry's
 * `native` field as `missingProps: ['centered']`. That field is RECORDED BUT NOT MECHANICALLY
 * CHECKED (`NativeParity` says so) — so without this file, a later edit that quietly re-adds a
 * centred branch to the sheet would leave the record lying with the whole suite green.
 *
 * WHAT IS BANNED, in the domain's words: the native dialog primitive deciding to present
 * anything other than the sheet. In source that is any identifier, key, string or default that
 * names centring — `centered`, `centred`, `isCentered`, `'centered'`, `DIALOG_PRESENTATION
 * .centered` — in `Dialog.tsx` OR in the style table it draws from. Matched on the STEM, not a
 * token boundary, precisely so the prefixed and British spellings cannot slip past, and
 * case-insensitively so a constant spelled `CENTERED` cannot either. Comments are stripped
 * first, line comments before block comments (docs/solutions/conventions/
 * a-comment-can-blind-a-regex-guard-test.md): both files explain the retired card in prose.
 *
 * SITED HERE, in `packages/ui`, because a guard only guards its own package — the call-site
 * half lives in `apps/mobile/src/__tests__/dialogs.test.ts` and would replay a cached pass over
 * a change to this file.
 *
 * PROVED RED (UMK-1075), one injection per spelling, each reverted:
 *
 * | Injection into `Dialog.tsx` / `overlay-styles.ts` | Reds |
 * | -- | -- |
 * | `centered?: boolean;` in `DialogProps` | code ban |
 * | `centered = false,` in the destructure | code ban |
 * | `props['centered']` string-key read | code ban |
 * | `isCentered` local | code ban |
 * | `centred: { … }` in `DIALOG_PRESENTATION` | code ban (styles) |
 * | `missingProps` emptied on the contract entry | **2** — record link AND `native-parity.test.ts`'s
 *   "argues itself", because a partial entry recording nothing missing is its own violation |
 *
 * WHAT IT CANNOT SEE: centring WITHOUT THE WORD — `justifyContent: dismissible ? 'flex-end' :
 * 'center'` on the modal root names nothing this matches. That shape is caught by rendering, in
 * `apps/mobile/src/__tests__/overlay-behaviour.test.tsx` ("is presented exactly as a plain
 * sheet"), which reads the resolved root and panel styles of both forms — a guard in the consumer,
 * so subject to the cache rule above, and recorded here rather than claimed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';

const NATIVE_DIR = resolve(__dirname, '..');

/** Line comments FIRST, then block comments — the order is the rule, not a preference. */
const codeOf = (file: string): string =>
  readFileSync(resolve(NATIVE_DIR, file), 'utf8')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const CENTRING = /cent(?:ere|re)d/gi;

describe('the native Dialog has no centred form', () => {
  it.each(['Dialog.tsx', 'overlay-styles.ts'])('%s names no centring in code', (file) => {
    const code = codeOf(file);
    /* Anti-vacuity: a stripper that ate the file would pass the ban on nothing. Both files are
       several KB of code once comments are gone; a truncation that leaves a stub fails here. */
    expect(code.length, `${file}: stripped to almost nothing`).toBeGreaterThan(2000);
    expect(code.match(CENTRING) ?? []).toEqual([]);
  });

  it('still recognises the thing it bans, so the pattern cannot go quiet', () => {
    for (const spelling of ['centered', 'centered={true}', '{...{ centered: true }}', 'isCentered', 'centred', "props['centered']", 'CENTERED']) {
      expect(spelling.match(CENTRING), spelling).not.toBeNull();
    }
    /* …and does not ban the layout word every flex style uses. */
    expect("alignItems: 'center', justifyContent: 'center'".match(CENTRING)).toBeNull();
  });

  it('draws on a Modal that is always the sheet, and the dialog is still the component under scan', () => {
    const code = codeOf('Dialog.tsx');
    expect(code).toMatch(/export const Dialog\b/);
    expect(code).toMatch(/DIALOG_PRESENTATION\.sheet/);
    expect(Object.keys((contract.Dialog.axes as Record<string, unknown>) ?? {})).toContain('size');
  });

  it('exposes the native Modal presentation event to fields that must focus after the sheet appears', () => {
    const code = codeOf('Dialog.tsx');
    expect(code).toMatch(/onShow\?:\s*\(\)\s*=>\s*void/);
    expect(code).toMatch(/<Modal[\s\S]*?onShow=\{onShow\}/);
  });

  it('keeps the contract record saying so', () => {
    const native = contract.Dialog.native;
    expect(native.state).toBe('partial');
    expect(native.state === 'partial' ? native.missingProps : undefined).toEqual(['centered', 'fullHeight', 'keyboardAware', 'titleClassName']);
    /* `size` went with the card: its ladder was the card's width. `native-parity.test.ts` checks
       this one mechanically, because it is an axis rather than a boolean. `side` (UMK-1186) is
       the web's edge drawer, and native stays a bottom sheet by the same decision. `rounded` (UMK-1548) is a web-only opt-in radius. */
    expect(native.state === 'partial' ? native.missingAxes : undefined).toEqual(['size', 'side', 'rounded']);
    /* The web half is untouched: the boolean is still declared for the web `Dialog`. */
    expect(contract.Dialog.booleans).toContain('centered');
  });
});
