import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from './variants';

/**
 * EVERY CONTRACT ENTRY IS EITHER CLAIMED BY A FAMILY OR NAMED HERE.
 *
 * The four family guard pairs each reconcile their own `MODULES` keyset against
 * `contractFamilyMembers(<family>)`, so a component that claims a family cannot ship without
 * behaviour coverage. An entry with NO `family` is invisible to all four — every guard asserts
 * against exactly the entries claiming its own family, so nobody expects it anywhere. That set
 * was four (`Button`, `Text`, `Icon`, `Label`) and doubled to eight; a ninth would ship green if it
 * were not named here.
 *
 * IT BRIEFLY HELD TEN. `ChatBar` and `Tools` were added unfamilied, then the composer was split
 * into seven components — which would have meant seven rows naming seven pairs. They became a
 * `composer` FAMILY instead, so `composer.stories.test.tsx` / `composer.purge.test.ts` reconcile
 * against every entry claiming it and the rows came back out. A family is the answer whenever a
 * component's siblings outnumber the row that would describe it.
 *
 * The demonstration, not the argument: deleting `sidebar.stories.test.tsx` and re-running the
 * suite left it green and merely shorter. A shipped component lost its only behaviour coverage
 * and nothing said so.
 *
 * SO THE ALLOWLIST IS THE POINT. Adding a row is where "what actually covers this?" gets asked
 * out loud, in review — which is why each row names its guard FILES rather than a count or a
 * bare name. A count cannot say which one went missing; the files can, and this guard reddens
 * naming the entry when one of them disappears or stops holding tests.
 */
const SRC = resolve(__dirname, '..');

/** Component name → the files that are the whole of its coverage, and why that is the answer. */
const ALLOWED: Array<[name: string, guards: readonly string[], reason: string]> = [
  [
    'Button',
    ['primitives/Button/Button.test.tsx', 'primitives/Button/Button.stories.test.ts'],
    'the original unfamilied four — every family has buttons in it, so it belongs to none; covered by its own pair',
  ],
  [
    'Text',
    ['primitives/Text/Text.test.tsx'],
    'the type scale rather than a family member; the role/weight matrix is asserted in its own file',
  ],
  [
    'Icon',
    ['primitives/Icon/Icon.test.tsx', 'primitives/Icon/Icon.stories.test.ts'],
    'a glyph registry, not a treatment family; the registry and its stories are guarded together',
  ],
  [
    'Label',
    [],
    'NO dedicated guard — a recorded gap, not a claim of coverage, and it now has NO OWNER: slice 6 (UMK-900) coupled Label to the contract and left this untouched. `code-to-contract.test.ts` was the tempting thing to put in the array above and would have passed the mechanical check — existsSync plus "contains it(" — while being a lie: it asserts where a vocabulary is DECLARED and says nothing about whether Label RENDERS correctly, which is the gap. Reconciling it with the per-control labels is behaviour and needs a new owner.',
  ],
  [
    'Sidebar',
    ['primitives/sidebar.stories.test.tsx', 'primitives/sidebar.purge.test.ts'],
    'one component with a rail and a drawer form; behaviour pair sited beside the shell rather than in a family',
  ],
  [
    'Header',
    ['primitives/header.stories.test.tsx', 'primitives/header.purge.test.ts'],
    'seven types that differ only by class, so it needs a purge guard of its own more than a family',
  ],
  [
    'Lightbox',
    ['primitives/lightbox.stories.test.tsx', 'primitives/lightbox.purge.test.ts'],
    'an overlay by shape but not in the overlays pair; its own behaviour + purge pair is the coverage',
  ],
  [
    'Pagination',
    [
      'primitives/Pagination/Pagination.test.tsx',
      'primitives/pagination.stories.test.tsx',
      'primitives/table.purge.test.ts',
      'native/__tests__/pagination.test.ts',
    ],
    'navigation, but the only pager; its behaviour file, stories guard and the purge guard it shares with Table are the coverage, and the native sibling (UMK-1601) is pinned by its own scan — its render is apps/mobile/src/design/__tests__/pagination.test.tsx, which this package cannot name',
  ],
  [
    'Table',
    [
      'primitives/datatable.test.tsx',
      'primitives/table.stories.test.tsx',
      'primitives/table.purge.test.ts',
    ],
    'content by category, but none of the family maps fits a column grid; DataTable behaviour, the stories guard and the shared purge guard are the coverage',
  ],
  [
    'AppShell',
    ['layouts/layouts.stories.test.tsx', 'layouts/layouts.purge.test.ts'],
    'a layout, not a primitive — the layouts pair is its family in everything but the contract key',
  ],
  [
    'Avatar',
    ['native/__tests__/ui-v2-surfaces.test.ts'],
    'native-ui-v2, native only: no web component, so no family pair can reach it. Initials and the https delegation are pinned here; the render is apps/mobile design/__tests__/ui-v2-surfaces.test.tsx, which this package cannot name',
  ],
  [
    'ListGroup',
    ['primitives/list-group.stories.test.tsx', 'primitives/list-group.purge.test.ts', 'native/__tests__/list-chrome.test.ts'],
    'no family on either platform (UMK-1840 added the web copy): the web pair pins the stories, the named group, both variants and the classes surviving the purge; on native the source scan is the coverage here and its rendered behaviour is in apps/mobile (list-chrome.test.tsx)',
  ],
  [
    'ListRow',
    [
      'primitives/list-row.stories.test.tsx',
      'primitives/list-row.purge.test.ts',
      'native/__tests__/list-chrome.test.ts',
      'native/__tests__/press-states.test.ts',
    ],
    'no family on either platform (UMK-1840 added the web copy): the web pair pins the stories, the link-or-button row, the external new tab, the disabled row, every axis value and the classes surviving the purge; on native the source scan and the pressed-treatment guard are the coverage here and its rendered behaviour is in apps/mobile (list-chrome.test.tsx)',
  ],
  [
    'TabBar',
    [
      'primitives/tab-bar.stories.test.tsx',
      'primitives/tab-bar.purge.test.ts',
      'native/__tests__/nav-chrome.test.ts',
      'native/__tests__/tab-indicator.test.ts',
    ],
    'no family on either platform (UMK-1757 added the web copy): the web pair pins the stories, the link-or-button item, the active ink and line, the forwarded ref a menu trigger needs and the classes surviving the purge; on native, the in-package source guard pins its motion, haptic, accessibility and adapter, the indicator suite pins the math its transform-only indicator is drawn from, and its behaviour suite lives in apps/mobile (src/design/__tests__/nav-chrome.test.tsx)',
  ],
  [
    'IconButton',
    ['native/__tests__/nav-chrome.test.ts'],
    'native-only (native-ui-v2) with no web module, so no web family pair can hold it; the in-package source guard pins its target, press and required label, and its behaviour suite lives in apps/mobile (src/design/__tests__/nav-chrome.test.tsx)',
  ],
  [
    'FeatureTile',
    ['native/__tests__/identity-cards.test.ts'],
    'native-only (native-ui-v2 identity); no web family pair can reach it. Its tone/token table, sources and press depth are pinned there; behaviour is in apps/mobile/src/design/__tests__/identity-cards.test.tsx',
  ],
  [
    'PhotoCard',
    ['native/__tests__/identity-cards.test.ts'],
    'native-only (native-ui-v2 identity); its cover geometry and sources are pinned there; behaviour is in apps/mobile/src/design/__tests__/identity-cards.test.tsx',
  ],
  [
    'CoinChip',
    ['native/__tests__/identity-cards.test.ts'],
    'native-only (native-ui-v2 identity); its formatter, paint and sources are pinned there; the count-up is in apps/mobile/src/design/__tests__/identity-cards.test.tsx',
  ],
  [
    'ProfileHeader',
    ['primitives/profile-header.stories.test.tsx', 'primitives/profile-header.purge.test.ts', 'native/__tests__/profile-header.test.ts'],
    'no family on either platform (UMK-1601 native, UMK-1840 the web copy). On the web the pair pins the stories, the initial or the glyph, the meta-line rule and the classes surviving the purge; on native the meta-line rule, the 50 pt avatar and the accessible header are pinned there, and the render is apps/mobile/src/design/__tests__/profile-header.test.tsx, which this package cannot name',
  ],
  [
    'MonthCalendar',
    ['native/__tests__/month-calendar-support.test.ts'],
    'native-only (UMK-1358, drawn in the app design file); no web family pair can reach it. The Monday-first grid, the month and year arithmetic, the Indonesian names and the no-local-time rule are pinned there; the render and the presses are apps/mobile/src/design/__tests__/month-calendar.test.tsx',
  ],
];

const unfamilied = Object.entries(contract)
  .filter(([, entry]) => (entry as { family?: string }).family === undefined)
  .map(([name]) => name)
  .sort();

describe('every contract entry is covered by a family or by a named guard', () => {
  it('names every unfamilied entry in the allowlist, and nothing else', () => {
    expect(ALLOWED.map(([name]) => name).sort()).toEqual(unfamilied);
  });

  /* Per ENTRY, and per FILE within it. A total-count floor over eight components would stay
     green with one of them dark (UMK-956) — so each row is its own assertion, named. */
  for (const [name, guards, reason] of ALLOWED) {
    it(`${name} still has the guards its allowlist row claims`, () => {
      if (guards.length === 0) {
        /* An empty row is allowed only when it SAYS it is a gap, so a row cannot be emptied
           into silence to make this pass. */
        expect(reason, `${name} claims no guard file without saying so`).toMatch(/no dedicated guard/i);
        return;
      }
      for (const guard of guards) {
        const path = resolve(SRC, guard);
        expect(existsSync(path), `${name}: ${guard} is gone`).toBe(true);
        const text = readFileSync(path, 'utf8');
        expect(text, `${name}: ${guard} holds no tests`).toMatch(/\bit\(/);
        /* A file that exists and has tests is not yet a guard for THIS component: any suite
           satisfied the row. It must at least name the component it is cited for. */
        expect(text, `${name}: ${guard} never names ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      }
    });
  }
});
